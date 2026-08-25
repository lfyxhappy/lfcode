package ai.lfcode.mobile.network

import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import kotlinx.serialization.json.Json
import okhttp3.CertificatePinner
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

object PinnedMobileApiFactory {
  fun create(payload: PairingPayload): MobileApi {
    val endpoint = payload.endpoint()
    val trustManager = pinnedTrustManager(payload.spkiSha256)
    val sslContext = SSLContext.getInstance("TLS").apply {
      init(null, arrayOf(trustManager), SecureRandom())
    }
    val client = OkHttpClient.Builder()
      .sslSocketFactory(sslContext.socketFactory, trustManager)
      .hostnameVerifier { hostname, session ->
        hostname == endpoint.host && session.peerCertificates.any { certificate ->
          certificate is X509Certificate && spkiSha256(certificate) == payload.spkiSha256
        }
      }
      .certificatePinner(
        CertificatePinner.Builder()
          .add(endpoint.host, "sha256/${payload.spkiSha256}")
          .build(),
      )
      .build()
    return Retrofit.Builder()
      .baseUrl(endpoint.toString().trimEnd('/').plus("/").toHttpUrl())
      .client(client)
      .addConverterFactory(Json { ignoreUnknownKeys = false }.asConverterFactory("application/json".toMediaType()))
      .build()
      .create(MobileApi::class.java)
  }

  private fun pinnedTrustManager(expectedPin: String) = object : X509TrustManager {
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
      require(chain.any { spkiSha256(it) == expectedPin }) { "Lfcode mobile certificate pin did not match" }
    }

    override fun getAcceptedIssuers() = emptyArray<X509Certificate>()
  }

  private fun spkiSha256(certificate: X509Certificate) = MessageDigest.getInstance("SHA-256")
    .digest(certificate.publicKey.encoded)
    .let { bytes -> android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP) }
}

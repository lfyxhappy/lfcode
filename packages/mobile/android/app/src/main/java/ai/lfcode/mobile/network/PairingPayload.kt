package ai.lfcode.mobile.network

import java.net.URI
import java.util.Base64
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

private const val MOBILE_PROTOCOL_VERSION = 1

@Serializable
data class PairingPayload(
  val protocolVersion: Int,
  val hostID: String,
  val endpoints: List<String>,
  val spkiSha256: String,
  val pairingKey: String,
  val expiresAt: Long,
) {
  fun endpoint(): URI = endpoints.firstOrNull()?.let(::URI) ?: error("Pairing payload has no endpoint")
}

object PairingPayloadParser {
  fun parse(value: String, now: Long = System.currentTimeMillis()): PairingPayload {
    val payload = Json { ignoreUnknownKeys = false }.decodeFromString<PairingPayload>(value)
    require(payload.protocolVersion == MOBILE_PROTOCOL_VERSION) { "Unsupported Lfcode mobile protocol" }
    require(payload.hostID.isNotBlank()) { "Pairing payload has no host ID" }
    require(payload.pairingKey.isNotBlank()) { "Pairing payload has no pairing key" }
    require(payload.expiresAt > now) { "Pairing QR code has expired" }
    require(payload.endpoints.isNotEmpty()) { "Pairing payload has no endpoint" }
    payload.endpoints.forEach(::requireHttpsEndpoint)
    require(Base64.getDecoder().decode(payload.spkiSha256).size == 32) { "Pairing payload has an invalid certificate pin" }
    return payload
  }

  private fun requireHttpsEndpoint(value: String) {
    val endpoint = runCatching { URI(value) }.getOrElse { error("Pairing payload has an invalid endpoint") }
    require(endpoint.scheme == "https") { "Lfcode mobile connections require HTTPS" }
    require(!endpoint.host.isNullOrBlank()) { "Pairing payload endpoint has no host" }
    require(endpoint.userInfo == null) { "Pairing payload endpoint must not contain credentials" }
  }
}

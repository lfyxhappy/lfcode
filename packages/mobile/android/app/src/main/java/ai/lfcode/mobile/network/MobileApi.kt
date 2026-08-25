package ai.lfcode.mobile.network

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

@Serializable
data class MobileHealth(
  val protocolVersion: Int,
  val hostID: String,
  val status: String,
)

@Serializable
data class PairRequest(
  val pairingKey: String,
  val deviceID: String,
  val deviceName: String,
)

@Serializable
data class PairedDevice(
  val id: String,
  val name: String,
  val createdAt: Long,
  val lastSeenAt: Long,
  val revokedAt: Long? = null,
)

@Serializable
data class PairResponse(
  val protocolVersion: Int,
  val hostID: String,
  val device: PairedDevice,
  val token: String,
)

interface MobileApi {
  @GET("mobile/v1/health")
  suspend fun health(): MobileHealth

  @POST("mobile/v1/pair")
  suspend fun pair(@Body request: PairRequest): PairResponse

  @GET("mobile/v1/host")
  suspend fun host(@Header("Authorization") authorization: String): HostResponse
}

@Serializable
data class HostResponse(
  val protocolVersion: Int,
  val hostID: String,
  val hostName: String,
  val version: String,
  val capabilities: List<String>,
  val device: PairedDevice,
  val serverTime: Long,
)

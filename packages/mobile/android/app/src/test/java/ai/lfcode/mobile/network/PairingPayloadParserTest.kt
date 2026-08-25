package ai.lfcode.mobile.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PairingPayloadParserTest {
  @Test
  fun acceptsAValidPinnedHttpsPayload() {
    val payload = PairingPayloadParser.parse(validPayload(), 1_000L)
    assertEquals("host_test", payload.hostID)
    assertEquals("desktop.local", payload.endpoint().host)
  }

  @Test
  fun rejectsExpiredOrInsecurePayloads() {
    assertThrows(IllegalArgumentException::class.java) {
      PairingPayloadParser.parse(validPayload().replace("2000", "1000"), 1_000L)
    }
    assertThrows(IllegalArgumentException::class.java) {
      PairingPayloadParser.parse(validPayload().replace("https://", "http://"), 1_000L)
    }
  }

  private fun validPayload() = """
    {"protocolVersion":1,"hostID":"host_test","endpoints":["https://desktop.local:4097"],"spkiSha256":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","pairingKey":"pair_test","expiresAt":2000}
  """.trimIndent()
}

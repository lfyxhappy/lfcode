package ai.lfcode.mobile.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class DeviceTokenStore(context: Context) {
  private val preferences = context.getSharedPreferences("mobile-device-tokens", Context.MODE_PRIVATE)

  fun save(hostID: String, token: String) {
    preferences.edit().putString(hostID, encrypt(token)).apply()
  }

  fun load(hostID: String): String? {
    val stored = preferences.getString(hostID, null) ?: return null
    return decrypt(stored)
  }

  fun remove(hostID: String) {
    preferences.edit().remove(hostID).apply()
  }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = store.getKey(KEY_ALIAS, null) as? SecretKey
    if (existing != null) return existing
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(
        KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .build(),
      )
    }.generateKey()
  }

  private fun encrypt(value: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val encrypted = cipher.doFinal(value.encodeToByteArray())
    return Base64.encodeToString(ByteBuffer.allocate(cipher.iv.size + encrypted.size).put(cipher.iv).put(encrypted).array(), Base64.NO_WRAP)
  }

  private fun decrypt(value: String): String? = runCatching {
    val bytes = Base64.decode(value, Base64.NO_WRAP)
    val iv = bytes.copyOfRange(0, GCM_IV_SIZE)
    val encrypted = bytes.copyOfRange(GCM_IV_SIZE, bytes.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
    cipher.doFinal(encrypted).decodeToString()
  }.getOrNull()

  private companion object {
    const val KEY_ALIAS = "lfcode-mobile-device-token"
    const val GCM_IV_SIZE = 12
  }
}

package ai.lfcode.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
          HostSetupScreen()
        }
      }
    }
  }
}

@Composable
private fun HostSetupScreen() {
  var address by remember { mutableStateOf("") }
  Column(
    modifier = Modifier.fillMaxSize().padding(PaddingValues(24.dp)),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    Text("连接 Lfcode", style = MaterialTheme.typography.headlineMedium)
    Text("扫描桌面端远程访问二维码，或输入已配对主机地址。连接始终使用 HTTPS 和证书指纹校验。")
    OutlinedTextField(
      modifier = Modifier.fillMaxWidth(),
      value = address,
      onValueChange = { address = it },
      label = { Text("主机地址") },
      singleLine = true,
    )
    Button(onClick = { }, enabled = address.isNotBlank()) {
      Text("检查连接")
    }
    Text("桌面端尚未开启远程访问时，手机不会尝试明文 HTTP 降级。", style = MaterialTheme.typography.bodySmall)
  }
}

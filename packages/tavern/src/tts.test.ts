import assert from "node:assert/strict"
import test from "node:test"
import { splitMimoTts } from "./index"

test("splits MiMo dialogue from narration without dropping surrounding text", () => {
  assert.deepEqual(splitMimoTts("雨落在窗上。\"别走。\"她低声说。"), [
    { text: "雨落在窗上。", dialogue: false },
    { text: "\"别走。\"", dialogue: true },
    { text: "她低声说。", dialogue: false },
  ])
})

import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useRoute } from "@tui/context/route"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { createMemo } from "solid-js"

export function DialogSubagent(props: { sessionID: string }) {
  const route = useRoute()
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()

  const actors = createMemo(() =>
    (sync.data.actor[props.sessionID] ?? [])
      .filter((a) => a.mode === "subagent" || a.mode === "peer")
      .toSorted((a, b) => a.time_created - b.time_created),
  )

  const options = createMemo(() => {
    const list = actors()
    if (list.length === 0) {
      return [
        {
          title: "(no subagents in this session)",
          value: "empty",
          description: "spawn one via the actor tool",
          onSelect: (dialog: { clear: () => void }) => dialog.clear(),
        },
      ]
    }
    return list.map((a) => ({
      title: `${a.actor_id}  ${a.agent}  ${a.status}`,
      value: a.actor_id,
      description: a.description,
      onSelect: (ctx: { clear: () => void }) => {
        if (a.mode === "subagent") {
          if (route.data.type === "session") {
            route.navigate({ ...route.data, agentID: a.actor_id })
          }
        } else {
          // peer mode: navigate to the actor's own session, viewing its own slice
          route.navigate({ type: "session", sessionID: a.session_id, agentID: a.actor_id })
        }
        ctx.clear()
      },
      footer: "enter=open, del=destroy",
    }))
  })

  return (
    <DialogSelect
      title="Subagents"
      options={options()}
      keybind={[
        {
          title: "destroy",
          side: "right",
          onTrigger: async (option) => {
            if (option.value === "empty") return
            const ok = await DialogConfirm.show(dialog, "Destroy subagent", `Destroy ${option.title}?`, "destroy")
            if (ok !== true) return
            await sdk.client.session.deleteActor({ sessionID: props.sessionID, actorID: option.value })
            dialog.clear()
          },
        },
      ]}
    />
  )
}

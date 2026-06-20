import { Component, Show } from "solid-js"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { List } from "@lfcode-ai/ui/list"
import { Tag } from "@lfcode-ai/ui/tag"
import { ProviderIcon } from "@lfcode-ai/ui/provider-icon"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { VOLCENGINE_CODING_PLAN_PROVIDER_ID } from "@lfcode-ai/shared/volcengine-coding-plan"

const CUSTOM_ID = "_custom"

export const DialogSelectProvider: Component<{ returnTo?: "models" }> = (props) => {
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()

  const popularGroup = () => language.t("dialog.provider.group.popular")
  const otherGroup = () => language.t("dialog.provider.group.other")
  const customLabel = () => language.t("settings.providers.tag.custom")
  const volcengineCodingPlanLabel = () => language.t("dialog.provider.volcengineCodingPlan.name")
  const note = (id: string) => {
    if (id === "anthropic") return language.t("dialog.provider.anthropic.note")
    if (id === "openai") return language.t("dialog.provider.openai.note")
    if (id.startsWith("github-copilot")) return language.t("dialog.provider.copilot.note")
    if (id === "lfcode-go") return language.t("dialog.provider.lfcodeGo.tagline")
  }

  return (
    <Dialog title={language.t("command.provider.connect")} transition>
      <List
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={() => {
          language.locale()
          const allProviders = providers.all().filter((provider) => provider.id !== VOLCENGINE_CODING_PLAN_PROVIDER_ID)
          return [
            { id: CUSTOM_ID, name: customLabel() },
            { id: VOLCENGINE_CODING_PLAN_PROVIDER_ID, name: volcengineCodingPlanLabel() },
            ...allProviders,
          ]
        }}
        filterKeys={["id", "name"]}
        groupBy={(x) => (popularProviders.includes(x.id) ? popularGroup() : otherGroup())}
        sortBy={(a, b) => {
          if (a.id === CUSTOM_ID) return -1
          if (b.id === CUSTOM_ID) return 1
          if (a.id === VOLCENGINE_CODING_PLAN_PROVIDER_ID) return -1
          if (b.id === VOLCENGINE_CODING_PLAN_PROVIDER_ID) return 1
          if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
            return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => {
          const popular = popularGroup()
          if (a.category === popular && b.category !== popular) return -1
          if (b.category === popular && a.category !== popular) return 1
          return 0
        }}
        onSelect={(x) => {
          if (!x) return
          if (x.id === CUSTOM_ID) {
            dialog.show(() => <DialogCustomProvider back="providers" returnTo={props.returnTo} />)
            return
          }
          dialog.show(() => <DialogConnectProvider provider={x.id} returnTo={props.returnTo} />)
        }}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
            <span>{i.name}</span>
            <Show when={i.id === "lfcode"}>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.lfcode.tagline")}</div>
            </Show>
            <Show when={i.id === CUSTOM_ID}>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </Show>
            <Show when={i.id === "lfcode"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
            <Show when={note(i.id)}>{(value) => <div class="text-14-regular text-text-weak">{value()}</div>}</Show>
            <Show when={i.id === "lfcode-go"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}

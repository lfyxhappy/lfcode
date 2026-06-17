import { Dialog } from "@lfcode-ai/ui/dialog"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { List } from "@lfcode-ai/ui/list"
import { Switch } from "@lfcode-ai/ui/switch"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import { Button } from "@lfcode-ai/ui/button"
import type { Component } from "solid-js"
import { Show } from "solid-js"
import { useLocal } from "@/context/local"
import { popularProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import { useDialog } from "@lfcode-ai/ui/context/dialog"
import { DialogRemoveProvider } from "./dialog-delete-custom-provider"
import { DialogSelectProvider } from "./dialog-select-provider"

export const DialogManageModels: Component = () => {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()

  const handleConnectProvider = () => {
    dialog.show(() => <DialogSelectProvider returnTo="models" />)
  }
  const providerRank = (id: string) => popularProviders.indexOf(id)
  const providerList = (providerID: string) => local.model.list().filter((x) => x.provider.id === providerID)
  const providerVisible = (providerID: string) =>
    providerList(providerID).every((x) => local.model.visible({ modelID: x.id, providerID: x.provider.id }))
  const setProviderVisibility = (providerID: string, checked: boolean) => {
    providerList(providerID).forEach((x) => {
      local.model.setVisibility({ modelID: x.id, providerID: x.provider.id }, checked)
    })
  }

  const reopenModels = () => dialog.show(() => <DialogManageModels />)

  return (
    <Dialog
      title={language.t("dialog.model.manage")}
      description={language.t("dialog.model.manage.description")}
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={handleConnectProvider}>
          {language.t("command.provider.connect")}
        </Button>
      }
    >
      <List
        search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.model.empty")}
        key={(x) => `${x?.provider?.id}:${x?.id}`}
        items={local.model.list()}
        filterKeys={["provider.name", "name", "id"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(x) => x.provider.id}
        groupHeader={(group) => {
          const provider = group.items[0].provider
          return (
            <div class="w-full flex items-center justify-between gap-3">
              <span class="truncate">{provider.name}</span>
              <div class="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Tooltip
                  placement="top"
                  value={language.t("dialog.model.manage.provider.delete", { provider: provider.name })}
                >
                  <IconButton
                    tabIndex={-1}
                    icon="trash"
                    variant="ghost"
                    aria-label={language.t("dialog.model.manage.provider.delete", { provider: provider.name })}
                    onClick={() =>
                      dialog.show(() => (
                        <DialogRemoveProvider
                          providerID={provider.id}
                          providerName={provider.name}
                          onClose={reopenModels}
                        />
                      ))
                    }
                  />
                </Tooltip>
                <Tooltip
                  placement="top"
                  value={language.t("dialog.model.manage.provider.toggle", { provider: provider.name })}
                >
                  <Switch
                    class="-mr-1"
                    checked={providerVisible(provider.id)}
                    onChange={(checked) => setProviderVisibility(provider.id, checked)}
                    hideLabel
                  >
                    {provider.name}
                  </Switch>
                </Tooltip>
              </div>
            </div>
          )
        }}
        sortGroupsBy={(a, b) => {
          const aRank = providerRank(a.items[0].provider.id)
          const bRank = providerRank(b.items[0].provider.id)
          const aPopular = aRank >= 0
          const bPopular = bRank >= 0
          if (aPopular && !bPopular) return -1
          if (!aPopular && bPopular) return 1
          return aRank - bRank
        }}
        onSelect={(x) => {
          if (!x) return
          const key = { modelID: x.id, providerID: x.provider.id }
          local.model.setVisibility(key, !local.model.visible(key))
        }}
      >
        {(i) => (
          <div class="w-full flex items-center justify-between gap-x-3">
            <span>{i.name}</span>
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={!!local.model.visible({ modelID: i.id, providerID: i.provider.id })}
                onChange={(checked) => {
                  local.model.setVisibility({ modelID: i.id, providerID: i.provider.id }, checked)
                }}
              />
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}

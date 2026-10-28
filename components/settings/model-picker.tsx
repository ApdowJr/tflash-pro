"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModelBrowser } from "./model-browser";
import { useAppSettings } from "./app-settings";

export function ModelPicker({
  open,
  onOpenChange,
  onOpenSettings,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenSettings: (providerId: string) => void;
}) {
  const { t } = useAppSettings();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent closeLabel={t("dismiss")} className="flex h-[min(80dvh,660px)] w-full flex-col gap-0 overflow-hidden p-0 max-sm:h-[calc(100dvh-1.5rem)] max-sm:max-w-[calc(100%-1rem)] sm:max-w-[min(42rem,calc(100%-2rem))]">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left sm:px-5">
          <DialogTitle className="text-[15px]">{t("chooseModel")}</DialogTitle>
          <DialogDescription className="text-xs">{t("modelPickerHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
          <ModelBrowser
            className="flex-1"
            onConnectRequest={(providerId) => {
              onOpenChange(false);
              onOpenSettings(providerId);
            }}
            onPick={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

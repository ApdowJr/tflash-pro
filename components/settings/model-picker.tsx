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
  readonly onOpenSettings: () => void;
}) {
  const { t } = useAppSettings();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[min(80dvh,660px)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 max-sm:h-[calc(100dvh-1.5rem)] max-sm:max-w-[calc(100%-1rem)]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("chooseModel")}</DialogTitle>
          <DialogDescription>{t("modelPickerHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
          <ModelBrowser
            className="flex-1"
            onConnectRequest={() => {
              onOpenChange(false);
              onOpenSettings();
            }}
            onPick={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModelBrowser } from "./model-browser";
import { useAppSettings } from "./settings-provider";

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
      <DialogContent className="flex h-[min(82dvh,680px)] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("chooseModel")}</DialogTitle>
          <DialogDescription>{t("modelPickerHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col p-4">
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

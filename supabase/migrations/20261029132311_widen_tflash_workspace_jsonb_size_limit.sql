alter table public.tflash_workspaces
  drop constraint tflash_workspaces_size;

alter table public.tflash_workspaces
  add constraint tflash_workspaces_size
  check (pg_column_size(workspace) <= 250000);

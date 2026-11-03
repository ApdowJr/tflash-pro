"use client";

import { APPROVE_OPTION_ID, DENY_OPTION_ID, signInEnding } from "eve/events";
import type {
  EveInteractionPart,
  EveMessage,
  EveMessagePart,
  EveToolPart,
  Interaction,
} from "eve/react";
import { useRef, useState, type FormEvent } from "react";
import { bashResultState } from "@/lib/activity";
import { planOutputSchema, artifactOutputSchema } from "@/lib/agent-workspace";
import { AgentPlanCard, AgentArtifactCard } from "./agent-workspace";
import { researchFetchOutputSchema, researchReportOutputSchema } from "@/lib/research";
import { ResearchSourceCard, ResearchReportCard } from "./research";
import {
  CheckCircleIcon,
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  KeyRoundIcon,
  XCircleIcon,
} from "lucide-react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
  BashToolContent,
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/components/settings/app-settings";

export type AgentInputResponse = {
  readonly interactionId: string;
  readonly optionId?: string;
  readonly text?: string;
};

type Asks = {
  readonly canRespond: (interactionId: string) => boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  /** Every question a call asked; its part holds only the latest. */
  readonly questionsFor: (callId: string) => readonly Interaction[];
};

type EveFilePart = Extract<EveMessagePart, { type: "file" }>;
type HeaderState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error";

export function AgentMessage({
  canRespond,
  message,
  onInputResponses,
  questionsFor,
}: Asks & { readonly message: EveMessage }) {
  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {message.parts.map((part, index) => {
          // Hidden control calls are the model waiting on or cancelling its own
          // background work, not activity to show.
          if (part.type === "tool" && part.kind === "control") return null;
          return (
            <AgentMessagePart
              canRespond={canRespond}
              key={partKey(part, index)}
              onInputResponses={onInputResponses}
              part={part}
              questionsFor={questionsFor}
            />
          );
        })}
      </MessageContent>
    </Message>
  );
}

function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  questionsFor,
}: {
  readonly canRespond: (interactionId: string) => boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly questionsFor: (callId: string) => readonly Interaction[];
}) {
  const asks: Asks = { canRespond, onInputResponses, questionsFor };
  switch (part.type) {
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={part.state === "streaming"}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "file":
      return <AttachmentPart part={part} />;
    case "interaction":
      return <InteractionPrompt asks={asks} part={part} />;
    case "tool":
      return <ToolPartView asks={asks} part={part} />;
  }
}

function ToolPartView({ asks, part }: { readonly asks: Asks; readonly part: EveToolPart }) {
  const { t } = useAppSettings();
  const questions = asks.questionsFor(part.callId);
  if (questions.length > 0) {
    return (
      <div className="space-y-4">
        {questions.map((question) => {
          // The call's part shows an answer this client sent at once; the view,
          // once eve has it.
          const current =
            part.interaction?.interactionId === question.interactionId ? part.interaction : question;
          return (
            <QuestionRequest
              answer={current.answer}
              canRespond={asks.canRespond(current.interactionId)}
              interaction={current}
              key={current.interactionId}
              onInputResponses={asks.onInputResponses}
            />
          );
        })}
      </div>
    );
  }

  if (part.state === "completed") {
    if (part.name === "web_fetch") {
      const parsed = researchFetchOutputSchema.safeParse(part.output);
      if (parsed.success) return <ResearchSourceCard source={parsed.data.source} />;
    }
    if (part.name === "create_research_report") {
      const parsed = researchReportOutputSchema.safeParse(part.output);
      if (parsed.success)
        return <ResearchReportCard artifact={parsed.data.artifact} sources={parsed.data.sources} />;
    }
    if (part.name === "update_plan") {
      const parsed = planOutputSchema.safeParse(part.output);
      if (parsed.success) return <AgentPlanCard plan={parsed.data.plan} />;
    }
    if (part.name === "create_artifact") {
      const parsed = artifactOutputSchema.safeParse(part.output);
      if (parsed.success) return <AgentArtifactCard artifact={parsed.data.artifact} />;
    }
  }

  const approval =
    part.interaction?.request.kind === "approval" ? part.interaction : undefined;
  const bashState =
    part.name === "bash" && part.state === "completed" ? bashResultState(part.output) : undefined;
  const status = toolStatus(part, bashState);
  return (
    <>
      <Tool defaultOpen={false} key={part.state === "approval" ? "review" : "activity"}>
        <ToolHeader
          state={toolHeaderState(part.state)}
          statusError={status?.error}
          statusLabel={status?.key ? t(status.key) : undefined}
          title={part.label}
          toolName={part.name}
          type="dynamic-tool"
        />
        <ToolContent>
          {part.name === "bash" ? (
            <BashToolContent
              errorText={part.error?.message}
              input={part.input}
              output={part.output}
            />
          ) : (
            <>
              <ToolInput input={part.input} />
              <ToolOutput errorText={part.error?.message} output={part.output} />
            </>
          )}
        </ToolContent>
      </Tool>
      {/* Kept outside the collapsed card so a pending approval is always visible. */}
      {approval ? (
        <InteractionActions asks={asks} interaction={approval} tool={part} />
      ) : null}
    </>
  );
}

function toolHeaderState(state: EveToolPart["state"]): HeaderState {
  switch (state) {
    case "streaming":
    case "requested":
      return "input-streaming";
    case "approval":
      return "approval-requested";
    case "running":
    case "blocked":
      return "input-available";
    case "completed":
      return "output-available";
    case "failed":
      return "output-error";
    case "rejected":
      return "output-denied";
    case "cancelled":
      return "output-denied";
  }
}

type TranslationKey = Parameters<ReturnType<typeof useAppSettings>["t"]>[0];

function toolStatus(
  part: EveToolPart,
  bashState: string | undefined,
): { key?: TranslationKey; error?: boolean } | undefined {
  switch (part.state) {
    case "streaming":
    case "requested":
      return { key: "activityPreparing" };
    case "approval":
      if (part.interaction?.outcome === "accepted") return { key: "activityApproved" };
      if (part.interaction?.outcome === "declined") return { key: "activityDenied" };
      return { key: "activityPending" };
    case "running":
    case "blocked":
      return { key: "activityRunning" };
    case "completed":
      if (bashState === "output-error") return { key: "activityFailed", error: true };
      if (bashState === "background-unknown") return { key: "activityBackgroundUnknown" };
      if (bashState === "outcome-unknown") return { key: "activityOutcomeUnknown" };
      return undefined;
    case "failed":
      return { key: "activityFailed", error: true };
    case "rejected":
      return { key: "activityDenied" };
    case "cancelled":
      return { key: "activityCancelled" };
  }
}

function QuestionRequest({
  answer,
  canRespond,
  interaction,
  onInputResponses,
}: {
  readonly answer?: Interaction["answer"];
  readonly canRespond: boolean;
  readonly interaction: Interaction;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [submittedOption, setSubmittedOption] = useState<string>();
  const options = interaction.request.options ?? [];
  const acceptsFreeform = interaction.request.allowFreeform === true || options.length === 0;
  const disabled = !canRespond || answer !== undefined;

  const submitResponse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get(interaction.interactionId);
    if (typeof value !== "string") {
      return;
    }

    const option = options.find(({ id }) => id === value);
    if (option === undefined) { setDraft(value); setSubmittedOption(undefined); }
    else setSubmittedOption(option.id);
    void Promise.resolve().then(() => onInputResponses([
      option === undefined
        ? { interactionId: interaction.interactionId, text: value.trim() }
        : { interactionId: interaction.interactionId, optionId: option.id },
    ])).catch(() => { /* The session recovery notice reports unconfirmed responses. */ });
  };

  return (
    <Questionnaire
      className="gap-4 rounded-xl border bg-card p-4"
      // Validation reads disabled answers as missing, so locking a submitted form in place would
      // flag it invalid. Remounting restores the answer from the response instead.
      key={disabled ? "locked" : "open"}
      onSubmit={submitResponse}
      shortcuts="numbers"
    >
      <QuestionnaireItem name={interaction.interactionId} required>
        <QuestionnaireTitle className="text-sm font-medium">
          {interaction.request.prompt}
        </QuestionnaireTitle>
        <QuestionnaireChoices>
          {options.map((option) => (
            <QuestionnaireChoice
              className={cn(answer?.optionId === option.id && "data-disabled:opacity-100")}
              defaultChecked={answer?.optionId === option.id || (answer === undefined && submittedOption === option.id)}
              disabled={disabled}
              key={option.id}
              value={option.id}
            >
              {option.label}
              {option.description ? (
                <QuestionnaireChoiceDescription>
                  {option.description}
                </QuestionnaireChoiceDescription>
              ) : null}
            </QuestionnaireChoice>
          ))}
          {acceptsFreeform ? (
            <QuestionnaireInput
              aria-label="Answer"
              className={cn(answer?.text !== undefined && "disabled:opacity-100")}
              defaultValue={answer?.text ?? draft}
              onChange={event => setDraft(event.target.value)}
              disabled={disabled}
              placeholder="Type your answer…"
            />
          ) : null}
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>
      {disabled ? null : (
        <QuestionnaireActions>
          <QuestionnaireSubmit size="sm">Answer</QuestionnaireSubmit>
        </QuestionnaireActions>
      )}
    </Questionnaire>
  );
}

function AttachmentPart({ part }: { readonly part: EveFilePart }) {
  const label = part.filename ?? "Attachment";
  const detail = [part.mediaType, formatBytes(part.size)].filter(Boolean).join(" - ");
  const isImage = part.mediaType.startsWith("image/") && part.url !== undefined;
  const Icon = isImage ? ImageIcon : FileIcon;
  const body = (
    <span className="flex max-w-sm items-center gap-3 rounded-md border bg-background/60 p-2 text-sm">
      {isImage ? (
        <img alt={label} className="size-12 shrink-0 rounded-sm object-cover" src={part.url} />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {detail ? <span className="block truncate text-muted-foreground">{detail}</span> : null}
      </span>
      {part.url ? <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" /> : null}
    </span>
  );

  return part.url ? (
    <a href={part.url} rel="noreferrer" target="_blank">
      {body}
    </a>
  ) : (
    body
  );
}

/** An interaction no call carries: a sign-in, the budget prompt, or a question of its own. */
function InteractionPrompt({
  asks,
  part,
}: {
  readonly asks: Asks;
  readonly part: EveInteractionPart;
}) {
  if (part.request.signIn !== undefined) return <SignInPrompt part={part} />;
  if (part.request.kind === "question") {
    return (
      <QuestionRequest
        answer={part.answer}
        canRespond={asks.canRespond(part.interactionId)}
        interaction={part}
        onInputResponses={asks.onInputResponses}
      />
    );
  }
  return <InteractionActions asks={asks} interaction={part} />;
}

function SignInPrompt({ part }: { readonly part: EveInteractionPart }) {
  const signIn = part.request.signIn;
  const name = signIn?.displayName ?? signIn?.name ?? "the service";
  const isAuthorized = part.outcome === "accepted";
  const isCompleted = part.status === "settled";
  const Icon = isAuthorized ? CheckCircleIcon : isCompleted ? XCircleIcon : KeyRoundIcon;
  const instructions = signIn?.instructions;
  const description = isCompleted
    ? isAuthorized
      ? `${name} connected.`
      : `${name} authorization ${signInEnding(part.outcome ?? "withdrawn")}${
          part.reason !== undefined ? ` (${part.reason})` : ""
        }.`
    : part.request.prompt;
  const shouldShowInstructions = instructions !== undefined && instructions !== description;

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border p-3.5",
        isAuthorized
          ? "border-emerald-500/25 bg-emerald-500/5"
          : isCompleted
            ? "border-destructive/25 bg-destructive/5"
            : "border-brand/35 bg-brand/6",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
            isAuthorized
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : isCompleted
                ? "bg-destructive/10 text-destructive"
                : "bg-brand/15 text-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-[13px]">
            {isCompleted
              ? isAuthorized
                ? `${name} connected`
                : `${name} authorization ${signInEnding(part.outcome ?? "withdrawn")}`
              : `Connect ${name}`}
          </p>
          <p className="text-pretty text-muted-foreground text-[12px] leading-relaxed">
            {description}
          </p>
          {!isCompleted && shouldShowInstructions ? (
            <p className="text-pretty text-muted-foreground text-[12px] leading-relaxed">
              {instructions}
            </p>
          ) : null}
          {!isCompleted && signIn?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Code</span>
              <code className="rounded-md bg-background px-2 py-1 font-mono">
                {signIn.userCode}
              </code>
            </div>
          ) : null}
          {!isCompleted && signIn?.url ? (
            <Button asChild className="h-8 gap-1.5 text-[12px]" size="sm">
              <a href={signIn.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-3.5" />
                Sign in with {name}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatBytes(size: number | undefined): string | undefined {
  if (size === undefined) {
    return undefined;
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** An interaction's prompt with a button for each option, or how it was answered. */
function InteractionActions({
  asks,
  interaction,
  tool,
}: {
  readonly asks: Asks;
  readonly interaction: Interaction;
  readonly tool?: EveToolPart;
}) {
  const { t } = useAppSettings();
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const submittingRef = useRef(false);
  const answer = interaction.answer;
  const options = interaction.request.options ?? [];
  const selectedOption = options.find((option) => option.id === answer?.optionId);
  const isApproval = interaction.request.kind === "approval";
  const isSettled = interaction.status === "settled";

  return (
    <div className="space-y-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
      {isApproval ? (
        <>
          <p className="text-sm font-semibold">{t("approvalRequired")}</p>
          <p className="line-clamp-3 break-words text-sm">
            {tool?.name === "bash" ? t("approvalShellSummary") : interaction.request.prompt}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              {t("approvalDetails")}
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 font-mono text-xs">
              <code>{JSON.stringify(tool?.input ?? interaction.call?.input ?? {}, null, 2) ?? "—"}</code>
            </pre>
          </details>
          {!answer && !isSettled ? (
            <p className="text-muted-foreground text-xs">{t("approvalScope")}</p>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{interaction.request.prompt}</p>
      )}
      {answer || selectedOption || isSettled ? (
        <p className="font-medium text-sm">
          Responded:{" "}
          {selectedOption?.label ??
            answer?.text ??
            answer?.optionId ??
            (interaction.outcome === "accepted"
              ? t("activityApproved")
              : interaction.outcome === "declined"
                ? t("activityDenied")
                : t("activityPending"))}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <Button
              className="min-h-11"
              disabled={submitting || !asks.canRespond(interaction.interactionId)}
              key={option.id}
              onClick={() => {
                if (submittingRef.current) return;
                submittingRef.current = true;
                setSubmitting(true);
                setSubmitFailed(false);
                void Promise.resolve().then(() => asks.onInputResponses([
                  { interactionId: interaction.interactionId, optionId: option.id },
                ])).catch(() => setSubmitFailed(true)).finally(() => {
                  submittingRef.current = false;
                  setSubmitting(false);
                });
              }}
              size="sm"
              type="button"
              variant={isApproval && option.id === DENY_OPTION_ID ? "outline" : option.style === "danger" ? "destructive" : "default"}
            >
              {isApproval && option.id === APPROVE_OPTION_ID ? t("approvalOnceButton") :
                isApproval && option.id === DENY_OPTION_ID ? t("approvalDenyButton") : option.label}
            </Button>
          ))}
        </div>
      )}
      {submitFailed ? <p className="text-xs text-destructive" role="alert">{t("approvalSendFailed")}</p> : null}
    </div>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "interaction":
      return `interaction:${part.interactionId}`;
    case "tool":
      return part.callId;
    case "reasoning":
    case "text":
      return `${part.type}:${part.id ?? index}`;
    default:
      return `${part.type}:${index}`;
  }
}

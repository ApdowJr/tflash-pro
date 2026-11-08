"use client";

import type { EveMessage, EveMessagePart, EveToolPart } from "eve/react";
import { signInEnding } from "eve/events";
import { memo, useRef, useState, type FormEvent } from "react";
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

type EveFilePart = Extract<EveMessagePart, { type: "file" }>;
type EveInteraction = NonNullable<EveToolPart["interaction"]>;
type ToolPresentationState =
  | "approval-requested"
  | "approval-responded"
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-denied"
  | "output-error";

type ToolPresentationPart = {
  readonly approval?: { readonly approved?: boolean };
  readonly errorText?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly partial?: boolean;
  readonly state: ToolPresentationState;
  readonly toolCallId: string;
  readonly toolMetadata?: { readonly eve?: { readonly inputRequest?: EveInteraction; readonly inputResponse?: AgentInputResponse; readonly label?: string } };
  readonly toolName: string;
};

export const AgentMessage = memo(function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
  questionsFor,
}: {
  readonly canRespond: (interactionId: string) => boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly questionsFor: (callId: string) => readonly EveInteraction[];
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );
  const hasAssistantText =
    message.role === "assistant" &&
    message.parts.some((part) => part.type === "text" && part.text.length > 0);

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {message.parts.map((part, index) =>
          hasAssistantText && part.type === "reasoning" ? null : (
            <AgentMessagePart
              canRespond={canRespond}
              isUser={message.role === "user"}
              key={partKey(part, index)}
              onInputResponses={onInputResponses}
              part={part}
              questionsFor={questionsFor}
              showCaret={isStreaming && message.role === "assistant" && index === lastTextIndex}
            />
          ),
        )}
      </MessageContent>
    </Message>
  );
});

function AgentMessagePart({
  canRespond,
  isUser = false,
  onInputResponses,
  part,
  questionsFor,
  showCaret,
}: {
  readonly canRespond: (interactionId: string) => boolean;
  readonly isUser?: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly questionsFor: (callId: string) => readonly EveInteraction[];
  readonly showCaret: boolean;
}) {
  const { t } = useAppSettings();
  switch (part.type) {
    case "text":
      return isUser ? (
        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{part.text}</p>
      ) : (
        <MessageResponse caret="block" className="text-[14px] leading-7 sm:text-[15px]" isAnimating={showCaret}>
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
      return part.request.kind === "sign-in" ? (
        <AuthorizationPrompt part={part} />
      ) : (
        <QuestionRequest
          canRespond={canRespond(part.interactionId)}
          interaction={part}
          onInputResponses={onInputResponses}
        />
      );
    case "tool": {
      const toolPart = toToolPresentationPart(part);
      const interaction = part.interaction;
      const isQuestion = interaction?.request.kind === "question" || interaction?.request.kind === "budget";
      const relatedQuestions = isQuestion ? [interaction] : [...questionsFor(part.callId)];
      const openQuestions = relatedQuestions.filter((question) => question.status === "open");
      if (openQuestions.length > 0) {
        return (
          <div className="space-y-4">
            {openQuestions.map((question) => (
              <QuestionRequest
                canRespond={canRespond(question.interactionId)}
                interaction={question}
                key={question.interactionId}
                onInputResponses={onInputResponses}
              />
            ))}
          </div>
        );
      }
      if (toolPart.state === "output-available" && !toolPart.partial) {
        if (toolPart.toolName === "web_fetch") {
          const parsed = researchFetchOutputSchema.safeParse(toolPart.output);
          if (parsed.success) return <ResearchSourceCard source={parsed.data.source} />;
        }
        if (toolPart.toolName === "create_research_report") {
          const parsed = researchReportOutputSchema.safeParse(toolPart.output);
          if (parsed.success) return <ResearchReportCard artifact={parsed.data.artifact} sources={parsed.data.sources} />;
        }
        if (toolPart.toolName === "update_plan") {
          const parsed = planOutputSchema.safeParse(toolPart.output);
          if (parsed.success) return <AgentPlanCard plan={parsed.data.plan} />;
        }
        if (toolPart.toolName === "create_artifact") {
          const parsed = artifactOutputSchema.safeParse(toolPart.output);
          if (parsed.success) return <AgentArtifactCard artifact={parsed.data.artifact} />;
        }
      }

      const bashState = toolPart.toolName === "bash" && toolPart.state === "output-available" && !toolPart.partial
        ? bashResultState(toolPart.output) : undefined;
      const statusKey = toolPart.state === "approval-requested" ? "activityPending" :
        toolPart.state === "approval-responded" ? (toolPart.approval?.approved === true ? "activityApproved" : toolPart.approval?.approved === false ? "activityDenied" : "activityPending") :
        toolPart.state === "input-streaming" ? "activityPreparing" :
        toolPart.state === "input-available" || (toolPart.state === "output-available" && toolPart.partial) ? "activityRunning" :
        toolPart.state === "output-denied" ? "activityDenied" : toolPart.state === "output-error" || bashState === "output-error" || (toolPart.state === "output-available" && !toolPart.partial && Boolean(toolPart.errorText)) ? "activityFailed" :
        bashState === "background-unknown" ? "activityBackgroundUnknown" : bashState === "outcome-unknown" ? "activityOutcomeUnknown" : undefined;
      return (
        <>
          <Tool key={toolPart.state === "approval-requested" ? "review" : "activity"} defaultOpen={false}>
            <ToolHeader
              state={toolPart.state}
              statusLabel={statusKey ? t(statusKey) : undefined}
              statusError={statusKey === "activityFailed"}
              title={toolPart.toolMetadata?.eve?.label ?? toolPart.toolName}
              toolName={toolPart.toolName}
              type="dynamic-tool"
            />
            <ToolContent>
              {toolPart.toolName === "bash" ? (
                <BashToolContent
                  errorText={toolPart.errorText}
                  input={toolPart.input}
                  output={toolPart.output}
                />
              ) : (
                <>
                  <ToolInput input={toolPart.input} />
                  <ToolOutput errorText={toolPart.errorText} output={toolPart.output} />
                </>
              )}
            </ToolContent>
          </Tool>
          {relatedQuestions.length > 0 ? (
            <div className="space-y-4">
              {relatedQuestions.map((question) => (
                <QuestionRequest
                  canRespond={canRespond(question.interactionId)}
                  interaction={question}
                  key={question.interactionId}
                  onInputResponses={onInputResponses}
                />
              ))}
            </div>
          ) : (
            <InputRequestActions canRespond={canRespond} part={toolPart} onInputResponses={onInputResponses} />
          )}
        </>
      );
    }
    default: {
      const legacyPart = legacyToolPartFromMessagePart(part);
      return legacyPart ? (
        <AgentMessagePart canRespond={canRespond} onInputResponses={onInputResponses} part={legacyPart} questionsFor={questionsFor} showCaret={showCaret} />
      ) : null;
    }
  }
}

function QuestionRequest({ 
  canRespond,
  interaction,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly interaction: EveInteraction;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [submittedOption, setSubmittedOption] = useState<string>();
  const options = interaction.request.options ?? [];
  const acceptsFreeform = interaction.request.allowFreeform === true || options.length === 0;
  const inputResponse = interaction.answer
    ? { interactionId: interaction.interactionId, optionId: interaction.answer.optionId, text: interaction.answer.text }
    : undefined;
  const disabled = !canRespond || interaction.status === "settled" || inputResponse !== undefined;

  const submitResponse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const answer = new FormData(event.currentTarget).get(interaction.interactionId);
    if (typeof answer !== "string") return;

    const option = options.find(({ id }) => id === answer);
    if (option === undefined) { setDraft(answer); setSubmittedOption(undefined); }
    else setSubmittedOption(option.id);
    void Promise.resolve().then(() => onInputResponses([
      option === undefined
        ? { interactionId: interaction.interactionId, text: answer.trim() }
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
          {interaction.request.title ?? interaction.request.prompt}
        </QuestionnaireTitle>
        <QuestionnaireChoices>
          {options.map((option) => (
            <QuestionnaireChoice
              className={cn(inputResponse?.optionId === option.id && "data-disabled:opacity-100")}
              defaultChecked={inputResponse?.optionId === option.id || (inputResponse === undefined && submittedOption === option.id)}
              disabled={disabled}
              key={option.id}
              value={option.id}
            >
              {option.label}
              {option.description ? (
                <QuestionnaireChoiceDescription>{option.description}</QuestionnaireChoiceDescription>
              ) : null}
            </QuestionnaireChoice>
          ))}
          {acceptsFreeform ? (
            <QuestionnaireInput
              aria-label="Answer"
              className={cn(inputResponse?.text !== undefined && "disabled:opacity-100")}
              defaultValue={inputResponse?.text ?? draft}
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

function AuthorizationPrompt({ part }: { readonly part: Extract<EveMessagePart, { type: "interaction" }> }) {
  const challenge = part.request.signIn;
  const displayName = challenge?.displayName ?? challenge?.name ?? "service";
  const ending = part.status === "settled" && part.outcome ? signInEnding(part.outcome) : undefined;
  const isAuthorized = ending === "connected";
  const isCompleted = part.status === "settled";
  const Icon = isAuthorized ? CheckCircleIcon : isCompleted ? XCircleIcon : KeyRoundIcon;
  const instructions = challenge?.instructions;
  const shouldShowInstructions = instructions !== undefined && instructions !== part.request.prompt;
  const signInUrl = challenge?.url ?? part.request.link?.url;
  const signInLabel = part.request.link?.label ?? `Sign in with ${displayName}`;
  const title = isAuthorized
    ? `${displayName} connected`
    : isCompleted
      ? `${displayName} authorization ${ending ?? "ended"}`
      : part.request.title ?? `Connect ${displayName}`;
  const description = isAuthorized
    ? `${displayName} connected.`
    : isCompleted
      ? `${displayName} authorization ${ending ?? "ended"}${part.reason ? ` (${part.reason})` : ""}.`
      : part.request.prompt;

  return (
    <div className={cn("space-y-3 rounded-xl border p-3.5", isAuthorized ? "border-emerald-500/25 bg-emerald-500/5" : isCompleted ? "border-destructive/25 bg-destructive/5" : "border-brand/35 bg-brand/6")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", isAuthorized ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : isCompleted ? "bg-destructive/10 text-destructive" : "bg-brand/15 text-foreground")}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-[13px]">{title}</p>
          <p className="text-pretty text-muted-foreground text-[12px] leading-relaxed">{description}</p>
          {shouldShowInstructions ? <p className="text-pretty text-muted-foreground text-[12px] leading-relaxed">{instructions}</p> : null}
          {part.status === "open" && challenge?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Code</span>
              <code className="rounded-md bg-background px-2 py-1 font-mono">{challenge.userCode}</code>
            </div>
          ) : null}
          {part.status === "open" && signInUrl ? (
            <Button asChild className="h-8 gap-1.5 text-[12px]" size="sm">
              <a href={signInUrl} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-3.5" />
                {signInLabel}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function legacyToolPartFromMessagePart(part: EveMessagePart): EveToolPart | undefined {
  const value = part as unknown as Record<string, unknown>;
  if (value.type !== "dynamic-tool") return;
  const metadata = record(value.toolMetadata);
  const eve = record(metadata?.eve);
  const rawRequest = record(eve?.inputRequest);
  const rawResponse = record(eve?.inputResponse);
  const approval = record(value.approval);
  const interactionId = typeof rawRequest?.interactionId === "string"
    ? rawRequest.interactionId
    : typeof rawRequest?.requestId === "string" ? rawRequest.requestId : undefined;
  const kind = rawRequest?.kind === "tool-approval" ? "approval"
    : rawRequest?.kind === "session-limit" ? "budget"
      : typeof rawRequest?.kind === "string" ? rawRequest.kind : undefined;
  const interaction = interactionId && rawRequest && kind ? {
    interactionId,
    request: {
      kind,
      prompt: typeof rawRequest.prompt === "string" ? rawRequest.prompt : "Input requested.",
      title: typeof rawRequest.title === "string" ? rawRequest.title : undefined,
      options: Array.isArray(rawRequest.options) ? rawRequest.options : [],
      allowFreeform: rawRequest.allowFreeform === true,
    },
    status: value.state === "approval-responded" || rawResponse || approval ? "settled" : "open",
    outcome: approval?.approved === true ? "accepted" : approval?.approved === false ? "declined" : undefined,
    answer: rawResponse ? { optionId: rawResponse.optionId, text: rawResponse.text } : undefined,
  } as unknown as NonNullable<EveToolPart["interaction"]> : undefined;
  const oldState = typeof value.state === "string" ? value.state : "";
  const state = oldState === "approval-requested" ? "approval"
    : oldState === "approval-responded" ? "blocked"
      : oldState === "input-streaming" ? "streaming"
        : oldState === "input-available" ? "running"
          : oldState === "output-available" ? "completed"
            : oldState === "output-denied" ? "rejected"
              : oldState === "output-error" ? "failed"
                : oldState;
  const callId = typeof value.toolCallId === "string" ? value.toolCallId : typeof value.callId === "string" ? value.callId : undefined;
  const name = typeof value.toolName === "string" ? value.toolName : typeof value.name === "string" ? value.name : undefined;
  if (!callId || !name) return;
  return {
    type: "tool",
    callId,
    name,
    state,
    input: value.input,
    inputText: typeof value.inputText === "string" ? value.inputText : undefined,
    output: value.output,
    error: typeof value.errorText === "string" ? { message: value.errorText } : undefined,
    label: typeof eve?.label === "string" ? eve.label : undefined,
    partial: value.partial === true,
    interaction,
  } as unknown as EveToolPart;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toToolPresentationPart(part: EveToolPart): ToolPresentationPart {
  const interaction = part.interaction;
  const state: ToolPresentationState = part.state === "streaming"
    ? "input-streaming"
    : part.state === "requested" || part.state === "running"
      ? "input-available"
      : part.state === "approval" || (part.state === "blocked" && interaction?.status !== "settled")
        ? "approval-requested"
        : part.state === "blocked"
          ? "approval-responded"
          : part.state === "completed"
            ? "output-available"
            : part.state === "rejected"
              ? "output-denied"
              : "output-error";
  const inputResponse = interaction?.answer
    ? { interactionId: interaction.interactionId, optionId: interaction.answer.optionId, text: interaction.answer.text }
    : undefined;

  return {
    approval: interaction?.outcome === "accepted"
      ? { approved: true }
      : interaction?.outcome === "declined"
        ? { approved: false }
        : undefined,
    errorText: part.state === "failed" || part.state === "completed" ? part.error?.message : undefined,
    input: part.state === "streaming" ? part.inputText : part.input,
    output: part.state === "completed" ? part.output : undefined,
    partial: part.state === "streaming" || (part as unknown as { partial?: unknown }).partial === true,
    state,
    toolCallId: part.callId,
    toolMetadata: interaction ? { eve: { inputRequest: interaction, inputResponse, label: part.label } } : { eve: { label: part.label } },
    toolName: part.name,
  };
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

export function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: (interactionId: string) => boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: ToolPresentationPart;
}) {
  const { t } = useAppSettings();
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const submittingRef = useRef(false);
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest || inputRequest.request.kind !== "approval") return null;

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const options = inputRequest.request.options ?? [];
  const selectedOption = options.find((option) => option.id === inputResponse?.optionId);
  const settledApproval = inputRequest.status === "settled"
    ? inputRequest.outcome === "accepted" ? "Approved" : inputRequest.outcome === "declined" ? "Denied" : undefined
    : undefined;

  return (
    <div className="space-y-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
      <p className="text-sm font-semibold">{t("approvalRequired")}</p>
      <p className="line-clamp-3 break-words text-sm">{part.toolName === "bash" ? t("approvalShellSummary") : inputRequest.request.prompt}</p>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("approvalDetails")}</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 font-mono text-xs"><code>{JSON.stringify(part.input, null, 2) ?? "—"}</code></pre>
      </details>
      {!inputResponse && !settledApproval ? <p className="text-muted-foreground text-xs">{t("approvalScope")}</p> : null}
      {inputResponse || settledApproval ? (
        <p className="font-medium text-sm">Responded: {selectedOption?.label ?? inputResponse?.text ?? inputResponse?.optionId ?? settledApproval}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <Button
              className="min-h-11"
              disabled={submitting || !canRespond(inputRequest.interactionId)}
              key={option.id}
              onClick={() => {
                if (submittingRef.current) return;
                submittingRef.current = true;
                setSubmitting(true);
                setSubmitFailed(false);
                void Promise.resolve().then(() => onInputResponses([
                  { interactionId: inputRequest.interactionId, optionId: option.id },
                ])).catch(() => setSubmitFailed(true)).finally(() => {
                  submittingRef.current = false;
                  setSubmitting(false);
                });
              }}
              size="sm"
              type="button"
              variant={option.id === "cancel" || option.id === "decline" || option.id === "deny" ? "outline" : option.style === "danger" ? "destructive" : "default"}
            >
              {option.id === "approve" ? t("approvalOnceButton") :
                option.id === "cancel" || option.id === "decline" || option.id === "deny" ? t("approvalDenyButton") : option.label}
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
      return `tool:${part.callId}`;
    case "reasoning":
    case "text":
      return `${part.type}:${part.id ?? index}`;
    case "file":
      return `file:${part.stepIndex ?? index}:${part.filename ?? "attachment"}`;
    default: {
      const legacy = part as unknown as Record<string, unknown>;
      return typeof legacy.toolCallId === "string" ? legacy.toolCallId : `${String(legacy.type)}:${index}`;
    }
  }
}

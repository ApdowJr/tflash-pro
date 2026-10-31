"use client";

import type {
  ConversationInput,
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessageInputRequest,
  EveMessagePart,
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
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

type EveFilePart = Extract<EveMessagePart, { type: "file" }>;

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
  questionsFor,
}: {
  readonly canRespond: (requestId: string) => boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly questionsFor: (callId: string) => readonly ConversationInput[];
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
}

function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  questionsFor,
  showCaret,
}: {
  readonly canRespond: (requestId: string) => boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly questionsFor: (callId: string) => readonly ConversationInput[];
  readonly showCaret: boolean;
}) {
  const { t } = useAppSettings();
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
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
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool": {
      if (part.state === "output-available" && !part.partial) {
        if (part.toolName === "web_fetch") {
          const parsed = researchFetchOutputSchema.safeParse(part.output);
          if (parsed.success) return <ResearchSourceCard source={parsed.data.source} />;
        }
        if (part.toolName === "create_research_report") {
          const parsed = researchReportOutputSchema.safeParse(part.output);
          if (parsed.success) return <ResearchReportCard artifact={parsed.data.artifact} sources={parsed.data.sources} />;
        }
        if (part.toolName === "update_plan") {
          const parsed = planOutputSchema.safeParse(part.output);
          if (parsed.success) return <AgentPlanCard plan={parsed.data.plan} />;
        }
        if (part.toolName === "create_artifact") {
          const parsed = artifactOutputSchema.safeParse(part.output);
          if (parsed.success) return <AgentArtifactCard artifact={parsed.data.artifact} />;
        }
      }
      const questions = questionsFor(part.toolCallId);
      if (questions.length > 0) {
        return (
          <div className="space-y-4">
            {questions.map(({ request, response }) => (
              <QuestionRequest
                canRespond={canRespond(request.requestId)}
                inputRequest={request}
                inputResponse={response}
                key={request.requestId}
                onInputResponses={onInputResponses}
              />
            ))}
          </div>
        );
      }

      const bashState = part.toolName === "bash" && part.state === "output-available" && !part.partial
        ? bashResultState(part.output) : undefined;
      const statusKey = part.state === "approval-requested" ? "activityPending" :
        part.state === "approval-responded" ? (part.approval?.approved === true ? "activityApproved" : part.approval?.approved === false ? "activityDenied" : "activityPending") :
        part.state === "input-streaming" ? "activityPreparing" :
        part.state === "input-available" || (part.state === "output-available" && part.partial) ? "activityRunning" :
        part.state === "output-denied" ? "activityDenied" : part.state === "output-error" || bashState === "output-error" ? "activityFailed" :
        bashState === "background-unknown" ? "activityBackgroundUnknown" : bashState === "outcome-unknown" ? "activityOutcomeUnknown" : undefined;
      return (
        <>
          <Tool key={part.state === "approval-requested" ? "review" : "activity"} defaultOpen={false}>
            <ToolHeader
              state={part.state}
              statusLabel={statusKey ? t(statusKey) : undefined}
              statusError={statusKey === "activityFailed"}
              title={part.toolMetadata?.eve?.label ?? part.toolName}
              toolName={part.toolName}
              type="dynamic-tool"
            />
            <ToolContent>
              {part.toolName === "bash" ? (
                <BashToolContent
                  errorText={part.errorText}
                  input={part.input}
                  output={part.output}
                />
              ) : (
                <>
                  <ToolInput input={part.input} />
                  <ToolOutput errorText={part.errorText} output={part.output} />
                </>
              )}
            </ToolContent>
          </Tool>
          {/* Kept outside the collapsed card so a pending approval is always visible. */}
          <InputRequestActions
            canRespond={canRespond}
            part={part}
            onInputResponses={onInputResponses}
          />
        </>
      );
    }
  }
}

function QuestionRequest({
  canRespond,
  inputRequest,
  inputResponse,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly inputRequest: EveMessageInputRequest;
  readonly inputResponse?: AgentInputResponse;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [submittedOption, setSubmittedOption] = useState<string>();
  const options = inputRequest.options ?? [];
  const acceptsFreeform = inputRequest.allowFreeform === true || options.length === 0;
  const disabled = !canRespond || inputResponse !== undefined;

  const submitResponse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const answer = new FormData(event.currentTarget).get(inputRequest.requestId);
    if (typeof answer !== "string") {
      return;
    }

    const option = options.find(({ id }) => id === answer);
    if (option === undefined) { setDraft(answer); setSubmittedOption(undefined); }
    else setSubmittedOption(option.id);
    void Promise.resolve().then(() => onInputResponses([
      option === undefined
        ? { requestId: inputRequest.requestId, text: answer.trim() }
        : { optionId: option.id, requestId: inputRequest.requestId },
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
      <QuestionnaireItem name={inputRequest.requestId} required>
        <QuestionnaireTitle className="text-sm font-medium">
          {inputRequest.prompt}
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
                <QuestionnaireChoiceDescription>
                  {option.description}
                </QuestionnaireChoiceDescription>
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

function AuthorizationPrompt({ part }: { readonly part: EveAuthorizationPart }) {
  const isAuthorized = part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized ? CheckCircleIcon : isCompleted ? XCircleIcon : KeyRoundIcon;
  const instructions = part.authorization?.instructions;
  const shouldShowInstructions = instructions !== undefined && instructions !== part.description;

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
          <p className="font-medium text-[13px]">{authorizationTitle(part)}</p>
          <p className="text-pretty text-muted-foreground text-[12px] leading-relaxed">
            {authorizationDescription(part)}
          </p>
          {shouldShowInstructions ? (
            <p className="text-pretty text-muted-foreground text-[12px] leading-relaxed">
              {instructions}
            </p>
          ) : null}
          {part.state === "required" && part.authorization?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Code</span>
              <code className="rounded-md bg-background px-2 py-1 font-mono">
                {part.authorization.userCode}
              </code>
            </div>
          ) : null}
          {part.state === "required" && part.authorization?.url ? (
            <Button asChild className="h-8 gap-1.5 text-[12px]" size="sm">
              <a href={part.authorization.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-3.5" />
                Sign in with {part.displayName}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return `Connect ${part.displayName}`;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected`;
  }
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return part.description;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected.`;
  }
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}${tail}.`;
}

function formatAuthorizationOutcome(outcome: NonNullable<EveAuthorizationPart["outcome"]>): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }
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
  readonly canRespond: (requestId: string) => boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const { t } = useAppSettings();
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const submittingRef = useRef(false);
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) {
    return null;
  }

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId,
  );
  // An approval can settle before its batch resolves, without an input response.
  const settledApproval =
    part.approval?.approved === undefined
      ? undefined
      : part.approval.approved
        ? "Approved"
        : "Denied";

  return (
    <div className="space-y-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
      {inputRequest.kind === "tool-approval" ? (
        <>
          <p className="text-sm font-semibold">{t("approvalRequired")}</p>
          <p className="line-clamp-3 break-words text-sm">{part.toolName === "bash" ? t("approvalShellSummary") : inputRequest.prompt}</p>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("approvalDetails")}</summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 font-mono text-xs"><code>{JSON.stringify(part.input, null, 2) ?? "—"}</code></pre>
          </details>
          {!inputResponse && !settledApproval ? <p className="text-muted-foreground text-xs">{t("approvalScope")}</p> : null}
        </>
      ) : <p className="text-muted-foreground text-sm">{inputRequest.prompt}</p>}
      {inputResponse || settledApproval ? (
        <p className="font-medium text-sm">
          Responded:{" "}
          {selectedOption?.label ??
            inputResponse?.text ??
            inputResponse?.optionId ??
            settledApproval}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {inputRequest.options?.map((option) => (
            <Button
              className="min-h-11"
              disabled={submitting || !canRespond(inputRequest.requestId)}
              key={option.id}
              onClick={() => {
                if (submittingRef.current) return;
                submittingRef.current = true;
                setSubmitting(true);
                setSubmitFailed(false);
                void Promise.resolve().then(() => onInputResponses([
                  { optionId: option.id, requestId: inputRequest.requestId },
                ])).catch(() => setSubmitFailed(true)).finally(() => {
                  submittingRef.current = false;
                  setSubmitting(false);
                });
              }}
              size="sm"
              type="button"
              variant={inputRequest.kind === "tool-approval" && option.id === "cancel" ? "outline" : option.style === "danger" ? "destructive" : "default"}
            >
              {inputRequest.kind === "tool-approval" && option.id === "approve" ? t("approvalOnceButton") :
                inputRequest.kind === "tool-approval" && option.id === "cancel" ? t("approvalDenyButton") : option.label}
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
    case "authorization":
      return part.attemptId === undefined
        ? `authorization:${part.turnId}:${part.stepIndex}:${part.name}`
        : `authorization:${part.attemptId}`;
    case "dynamic-tool":
      return part.toolCallId;
    case "reasoning":
    case "text":
      return `${part.type}:${part.id ?? index}`;
    default:
      return `${part.type}:${index}`;
  }
}

import { AuthenticatedAgentChat } from "@/components/chat/authenticated-agent-chat";

/** A clean new-chat surface with the same landing experience as `/`. */
export default function NewSessionPage() {
  return <AuthenticatedAgentChat />;
}

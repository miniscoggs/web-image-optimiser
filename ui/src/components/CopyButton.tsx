import { useState } from "react";

/**
 * {@link CopyButton}'s props: its label, and the text it copies, if there is any yet.
 */
type CopyButtonProps = { label: string; text: string | undefined };

/**
 * Renders a button that copies text to the clipboard, and says whether it worked.
 *
 * @param props - The label and the text.
 */
function CopyButton({ label, text }: CopyButtonProps) {
  const [feedback, setFeedback] = useState<string>();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text ?? "");
      setFeedback("Copied");
    } catch {
      setFeedback("Couldn't copy");
    }
    setTimeout(() => {
      setFeedback(undefined);
    }, 1500);
  };

  return (
    <button
      type="button"
      disabled={text === undefined || text === ""}
      onClick={() => void copy()}
    >
      <span aria-live="polite">{feedback ?? label}</span>
    </button>
  );
}

export default CopyButton;
export type { CopyButtonProps };

import type { KeyEvent } from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import type { AppTheme } from "../../themes";
import { isEscapeKey } from "../../lib/keyboard";
import { fitText } from "../../lib/text";
import { ModalFrame } from "./ModalFrame";

const fields = [
  { label: "Name", placeholder: "api review" },
  { label: "Project", placeholder: "/path/to/repository" },
  { label: "Range", placeholder: "main...feature (optional)" },
] as const;

/** Collect the minimal project/range fields needed to create one review tab from the TUI. */
export function NewReviewTabDialog({
  error,
  focusIndex,
  terminalHeight,
  terminalWidth,
  theme,
  values,
  onBackspace,
  onClose,
  onMoveFocus,
  onSubmit,
  onText,
}: {
  error?: string;
  focusIndex: number;
  terminalHeight: number;
  terminalWidth: number;
  theme: AppTheme;
  values: readonly [string, string, string];
  onBackspace: () => void;
  onClose: () => void;
  onMoveFocus: (delta: number) => void;
  onSubmit: () => void;
  onText: (text: string) => void;
}) {
  useKeyboard((key: KeyEvent) => {
    const own = () => {
      key.preventDefault();
      key.stopPropagation();
    };
    if (isEscapeKey(key)) {
      own();
      onClose();
      return;
    }
    if (key.name === "tab" || key.name === "down") {
      own();
      onMoveFocus(1);
      return;
    }
    if (key.name === "up") {
      own();
      onMoveFocus(-1);
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      own();
      onSubmit();
      return;
    }
    if (key.name === "backspace") {
      own();
      onBackspace();
      return;
    }
    const text = key.sequence ?? key.raw;
    if (!key.ctrl && !key.meta && text && !/[\u0000-\u001f\u007f]/u.test(text)) {
      own();
      onText(text);
    }
  });

  usePaste((event) => {
    onText(new TextDecoder().decode(event.bytes).replaceAll(/[\r\n\t]/gu, " "));
  });

  return (
    <ModalFrame
      height={11}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
      theme={theme}
      title="New review tab"
      width={72}
      onClose={onClose}
    >
      {fields.map((field, index) => (
        <box key={field.label} style={{ width: "100%", height: 2, flexDirection: "column" }}>
          <text fg={index === focusIndex ? theme.accent : theme.muted}>{field.label}</text>
          <box style={{ width: "100%", height: 1, backgroundColor: theme.panelAlt }}>
            <text fg={theme.text}>
              {fitText(
                `${values[index] || field.placeholder}${index === focusIndex ? "▏" : ""}`,
                66,
              )}
            </text>
          </box>
        </box>
      ))}
      <box style={{ width: "100%", height: 1 }}>
        <text fg={error ? theme.badgeRemoved : theme.muted}>
          {error ?? "Tab/↑↓ fields  Enter next/create  Esc cancel"}
        </text>
      </box>
    </ModalFrame>
  );
}

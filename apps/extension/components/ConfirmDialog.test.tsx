import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

type DialogOptions = {
  destructive?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
};

function renderDialog({
  destructive = false,
  onConfirm = () => undefined,
  onCancel = () => undefined,
}: DialogOptions = {}) {
  return render(
    <ConfirmDialog
      title="Delete everything?"
      message="This action cannot be undone."
      confirmLabel="Delete"
      cancelLabel="Cancel"
      destructive={destructive}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
}

afterEach(cleanup);

describe("ConfirmDialog", () => {
  it("renders an accessible modal with the given labels", () => {
    renderDialog({ destructive: true });

    const dialog = screen.getByRole("dialog", { name: "Delete everything?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("This action cannot be undone.");
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
      "bg-red-600",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).not.toHaveClass(
      "bg-red-600",
    );
  });

  it("uses the neutral style when not destructive", () => {
    renderDialog();

    expect(screen.getByRole("button", { name: "Delete" })).not.toHaveClass(
      "bg-red-600",
    );
  });

  it("invokes the matching callback for each button", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ onConfirm, onCancel });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("focuses the confirm action and traps Tab inside the dialog", async () => {
    renderDialog();

    const confirm = screen.getByRole("button", { name: "Delete" });
    const cancel = screen.getByRole("button", { name: "Cancel" });

    expect(confirm).toHaveFocus();

    await userEvent.tab();
    expect(cancel).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it("cancels on Escape and confirms on Enter", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ onConfirm, onCancel });

    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously focused element on unmount", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = renderDialog();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});

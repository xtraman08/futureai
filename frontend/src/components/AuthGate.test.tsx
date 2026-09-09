import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthGate } from "@/components/AuthGate";
import { boardFixture, jsonResponse } from "@/test/board-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ChatSidebar", () => ({
  ChatSidebar: () => null,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthGate", () => {
  it("shows the login form when there is no session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));

    render(<AuthGate />);

    expect(
      await screen.findByRole("heading", { name: /sign in to your workspace/i }),
    ).toBeInTheDocument();
  });

  it("restores an authenticated session", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({ authenticated: true, username: "user" }),
      )
      .mockResolvedValueOnce(jsonResponse(boardFixture())));

    render(<AuthGate />);

    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" }),
    ).toBeInTheDocument();
    expect(screen.getByText("user")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it("shows invalid credential errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(
        jsonResponse({ detail: "Invalid username or password" }, 401),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AuthGate />);
    await screen.findByRole("heading", { name: /sign in to your workspace/i });
    await user.type(screen.getByLabelText(/username/i), "user");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("Invalid username or password");
  });

  it("signs in and signs out", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(
        jsonResponse({ authenticated: true, username: "user" }),
      )
      .mockResolvedValueOnce(jsonResponse(boardFixture()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AuthGate />);
    await screen.findByRole("heading", { name: /sign in to your workspace/i });
    await user.type(screen.getByLabelText(/username/i), "user");
    await user.type(screen.getByLabelText(/password/i), "password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "user", password: "password" }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /^sign out$/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /sign in to your workspace/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows a connection error when the session check fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<AuthGate />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to connect to the server",
    );
  });

  it("returns to sign in when board authentication expires", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ authenticated: true, username: "user" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ detail: "Not authenticated" }, 401),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthGate />);

    expect(
      await screen.findByRole("heading", { name: /sign in to your workspace/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("session expired");
  });
});

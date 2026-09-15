/**
 * Die Glocke zählt ungesehenes App Feedback — live (ADR-0006): kommt eine
 * Meldung dazu, steigt die Zahl, ohne dass jemand die Seite neu lädt.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/feedback", async (original) => {
  const echt = await original<typeof import("@/lib/feedback")>();
  return { ...echt, feedbackApi: { ...echt.feedbackApi, ungeseheneAnzahl: vi.fn(async () => 2) } };
});
const live = vi.hoisted(() => ({ useLiveTabellen: vi.fn() }));
vi.mock("@/components/realtime/live", () => live);

import { SprachAnbieter } from "@/components/sprache/anbieter";
import { FeedbackGlocke } from "../glocke";

describe("FeedbackGlocke", () => {
  it("hält App Feedback live", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SprachAnbieter sprache="de">
          <FeedbackGlocke />
        </SprachAnbieter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(live.useLiveTabellen).toHaveBeenCalledWith(["feedback"]);
  });
});

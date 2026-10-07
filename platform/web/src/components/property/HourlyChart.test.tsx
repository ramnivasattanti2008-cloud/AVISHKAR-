import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HourlyChart, dayAxis } from "./HourlyChart";

const utc = (s: string) => new Date(s).getTime();

describe("dayAxis (time zone is Asia/Kolkata, see vitest.config.ts)", () => {
  it("labels each local day once, under its own data, and marks every local midnight without a label", () => {
    // 3 days of hourly data: 05:30 IST on Wed 7 Oct to 04:30 IST on Sat 10 Oct 2026.
    const { ticks, labels } = dayAxis(utc("2026-10-07T00:00:00Z"), utc("2026-10-09T23:00:00Z"));
    expect([...labels.values()]).toEqual(["Wed 7", "Thu 8", "Fri 9"]); // Sat 10 has only 4.5 h of data, so no label
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    const midnights = ticks.filter((t) => !labels.has(t));
    expect(midnights.map((t) => new Date(t).toISOString())).toEqual(["2026-10-07T18:30:00.000Z", "2026-10-08T18:30:00.000Z", "2026-10-09T18:30:00.000Z"]);
    // Each label sits inside its own day, between the two midnights around it.
    const [wed, thu] = [...labels.keys()];
    expect(wed!).toBeGreaterThan(utc("2026-10-07T00:00:00Z"));
    expect(wed!).toBeLessThan(midnights[0]!);
    expect(thu!).toBeGreaterThan(midnights[0]!);
    expect(thu!).toBeLessThan(midnights[1]!);
  });

  it("does not label a day that has under six hours of data", () => {
    const { labels } = dayAxis(utc("2026-10-07T00:00:00Z"), utc("2026-10-07T03:00:00Z"));
    expect(labels.size).toBe(0);
  });
});

describe("HourlyChart", () => {
  it("refuses to draw a chart with no data", () => {
    render(<HourlyChart points={[]} unit="W/m²" status="FORECAST" source="open-meteo" />);
    expect(screen.getByText("No data to chart.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("describes the real range it shows for screen readers", () => {
    const points = Array.from({ length: 48 }, (_, i) => ({ time: new Date(utc("2026-10-07T00:00:00Z") + i * 3_600_000).toISOString(), value: i }));
    render(<HourlyChart points={points} unit="°C" status="FORECAST" source="open-meteo" />);
    const label = screen.getByRole("img").getAttribute("aria-label")!;
    expect(label).toContain("48 hourly values in °C");
    expect(label).toContain("Wed, 7 Oct");
  });
});

import { describe, expect, it, vi } from "vitest";
import { STREAM_FILTERS, STREAM_SORTS, type StreamFilter } from "@/lib/streamList";
import { findAll, textOf } from "@/lib/testing/elementTree";
import type { Stream } from "@/types";
import { StreamFilterBar } from "./StreamFilterBar";

const COUNTS: Record<StreamFilter, number> = { all: 4, live: 2, completed: 1, cancelled: 1 };

function stream(id: string): Stream {
  return {
    id,
    sender: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
    recipient: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    token: { contractId: "CTOKEN", symbol: "XLM", decimals: 7 },
    totalAmount: "15000000",
    withdrawnAmount: "0",
    startLedger: 100,
    endLedger: 200,
    startTime: 0,
    endTime: 0,
    cancellable: true,
    status: "active",
  };
}

function render(overrides: Partial<Parameters<typeof StreamFilterBar>[0]> = {}) {
  const props = {
    value: "all" as StreamFilter,
    onChange: vi.fn(),
    query: "",
    onQueryChange: vi.fn(),
    sort: STREAM_SORTS[0].value,
    onSortChange: vi.fn(),
    counts: COUNTS,
    exportable: [stream("1")],
    exportName: "sending",
    ...overrides,
  };
  return { props, element: StreamFilterBar(props) };
}

const filterButtons = (element: ReturnType<typeof StreamFilterBar>) =>
  findAll(element, (el) => el.type === "button" && "aria-pressed" in el.props);

describe("StreamFilterBar", () => {
  it("renders one pressable tab per filter with its count", () => {
    const { element } = render();
    const buttons = filterButtons(element);

    expect(buttons).toHaveLength(STREAM_FILTERS.length);
    STREAM_FILTERS.forEach((filter, index) => {
      expect(textOf(buttons[index])).toContain(filter.label);
      expect(textOf(buttons[index])).toContain(String(COUNTS[filter.value]));
    });
  });

  it("marks only the selected filter as pressed", () => {
    const { element } = render({ value: "completed" });
    const pressed = filterButtons(element).map((button) => button.props["aria-pressed"]);

    expect(pressed).toEqual(STREAM_FILTERS.map((filter) => filter.value === "completed"));
  });

  it("selects a filter when its tab is clicked", () => {
    const { element, props } = render();
    const buttons = filterButtons(element);

    STREAM_FILTERS.forEach((filter, index) => {
      (buttons[index].props.onClick as () => void)();
      expect(props.onChange).toHaveBeenLastCalledWith(filter.value);
    });
  });

  it("reports search and sort changes", () => {
    const { element, props } = render();
    const [search] = findAll(element, (el) => el.type === "input");
    const [select] = findAll(element, (el) => el.type === "select");

    (search.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "GBRP" } });
    (select.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: STREAM_SORTS[1].value },
    });

    expect(props.onQueryChange).toHaveBeenCalledWith("GBRP");
    expect(props.onSortChange).toHaveBeenCalledWith(STREAM_SORTS[1].value);
  });

  it("disables CSV export when there is nothing to export", () => {
    const { element } = render({ exportable: [] });
    const [download] = findAll(element, (el) => el.type === "button" && textOf(el) === "Download CSV");

    expect(download.props.disabled).toBe(true);
  });

  it("enables CSV export when streams are visible", () => {
    const { element } = render();
    const [download] = findAll(element, (el) => el.type === "button" && textOf(el) === "Download CSV");

    expect(download.props.disabled).toBe(false);
  });
});

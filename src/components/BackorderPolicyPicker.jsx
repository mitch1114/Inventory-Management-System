// Shown in the ship-confirmation modals when an order still has backordered
// units. Lets the shipper choose between "fill & kill" (cancel the remainder,
// recorded for fill-rate reporting) and splitting the remainder into a tracked
// backorder order. Pairs with resolveBackorders() in lib/inventory.js.
export default function BackorderPolicyPicker({ count, value, onChange }) {
  const OPTIONS = [
    {
      key: "kill",
      title: "Fill & kill",
      desc: "Cancel the remaining units. The shortfall stays on record so fill-rate reporting reflects it.",
    },
    {
      key: "split",
      title: "Keep tracking",
      desc: "Move the remainder to a new backorder order that stays in the pipeline and auto-fills when stock arrives.",
    },
  ];
  return (
    <div
      style={{
        background: "#FFF7ED",
        border: "1px solid #FED7AA",
        borderRadius: 10,
        padding: "12px 14px",
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "#9A3412", marginBottom: 8 }}>
        This order still has {count} backordered unit{count !== 1 ? "s" : ""}. What should happen to
        them when it ships?
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {OPTIONS.map((opt) => (
          <label
            key={opt.key}
            style={{
              display: "flex",
              gap: 9,
              alignItems: "flex-start",
              cursor: "pointer",
              background: value === opt.key ? "#FFFFFF" : "transparent",
              border: `1px solid ${value === opt.key ? "#FDBA74" : "transparent"}`,
              borderRadius: 8,
              padding: "7px 9px",
            }}
          >
            <input
              type="radio"
              name="bo-policy"
              checked={value === opt.key}
              onChange={() => onChange(opt.key)}
              style={{ marginTop: 2 }}
            />
            <span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#7C2D12" }}>{opt.title}</span>
              <span style={{ fontSize: 12, color: "#9A3412", display: "block", marginTop: 1 }}>
                {opt.desc}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

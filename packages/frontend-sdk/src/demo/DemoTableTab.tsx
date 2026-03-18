import React, { useSyncExternalStore } from "react";
import { orderStore, type OrderFilters } from "./demo-store";
import type { DemoStrings } from "./demo-i18n";

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = ["Electronics", "Clothing", "Home & Kitchen", "Books", "Sports", "Beauty"];
const STATUS_OPTIONS = ["delivered", "shipped", "processing", "cancelled", "refunded"];
const PAYMENT_OPTIONS = [
  { value: "credit_card", label: "Credit Card" },
  { value: "paypal", label: "PayPal" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "crypto", label: "Crypto" },
];
const REGION_OPTIONS = ["North America", "Europe", "Asia", "Oceania", "South America"];
const PLATFORM_OPTIONS = [
  { value: "web", label: "Web" },
  { value: "mobile_ios", label: "iOS" },
  { value: "mobile_android", label: "Android" },
];
const FULFILLMENT_OPTIONS = [
  { value: "", label: "Any" },
  { value: "standard", label: "Standard" },
  { value: "express", label: "Express" },
  { value: "same_day", label: "Same Day" },
];
const RATING_OPTIONS = [
  { value: "", label: "Any" },
  { value: "5", label: "5 Stars" },
  { value: "4", label: "4 Stars" },
  { value: "3", label: "3 Stars" },
  { value: "2", label: "2 Stars" },
  { value: "1", label: "1 Star" },
  { value: "none", label: "Not Rated" },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  delivered: { bg: "#f0fdf4", text: "#16a34a" },
  shipped: { bg: "#eff6ff", text: "#2563eb" },
  processing: { bg: "#fffbeb", text: "#d97706" },
  cancelled: { bg: "#fef2f2", text: "#dc2626" },
  refunded: { bg: "#faf5ff", text: "#9333ea" },
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#64748b",
  marginBottom: 3,
  textTransform: "uppercase",
  letterSpacing: 0.3,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #e2e8f0",
  fontSize: 12,
  color: "#334155",
  background: "#fff",
  boxSizing: "border-box",
  outline: "none",
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };

const checkboxGroupStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: "3px 10px",
  borderRadius: 12,
  border: active ? "1px solid #3b82f6" : "1px solid #e2e8f0",
  background: active ? "#eff6ff" : "#fff",
  color: active ? "#2563eb" : "#64748b",
  fontSize: 11,
  fontWeight: active ? 600 : 400,
  cursor: "pointer",
  transition: "all 0.1s",
  whiteSpace: "nowrap",
});

const radioStyle = (active: boolean): React.CSSProperties => ({
  padding: "3px 10px",
  borderRadius: 12,
  border: active ? "1px solid #3b82f6" : "1px solid #e2e8f0",
  background: active ? "#eff6ff" : "#fff",
  color: active ? "#2563eb" : "#64748b",
  fontSize: 11,
  fontWeight: active ? 600 : 400,
  cursor: "pointer",
  transition: "all 0.1s",
  whiteSpace: "nowrap",
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toggleArrayValue(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function updateFilter(key: keyof OrderFilters, value: any) {
  orderStore.setFilters({ [key]: value });
}

// ─── Component ───────────────────────────────────────────────────────────────

interface DemoTableTabProps {
  strings: DemoStrings;
}

export function DemoTableTab({ strings }: DemoTableTabProps) {
  const state = useSyncExternalStore(orderStore.subscribe, orderStore.getSnapshot);
  const { filters, filteredOrders, totalOrders } = state;

  const activeFilterCount = countActiveFilters(filters);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1e293b" }}>
          {strings.tableTitle}
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
          {strings.tableDescription}
        </p>
      </div>

      {/* Filters Panel */}
      <div
        style={{
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          background: "#fff",
          padding: 16,
          flexShrink: 0,
        }}
      >
        {/* Filter header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Filters</span>
            {activeFilterCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "#eff6ff", color: "#2563eb" }}>
                {activeFilterCount} active
              </span>
            )}
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => orderStore.resetFilters()}
              style={{
                fontSize: 11,
                color: "#64748b",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {strings.tableResetFilters}
            </button>
          )}
        </div>

        {/* Filters Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {/* 1. Search */}
          <FilterField label="Search">
            <input
              style={inputStyle}
              type="text"
              placeholder="Order ID, customer, product..."
              value={filters.search}
              onChange={(e) => updateFilter("search", e.target.value)}
            />
          </FilterField>

          {/* 2. Category (multi-select chips) */}
          <FilterField label="Category" span={2}>
            <div style={checkboxGroupStyle}>
              {CATEGORY_OPTIONS.map((c) => (
                <span
                  key={c}
                  onClick={() => updateFilter("category", toggleArrayValue(filters.category, c))}
                  style={chipStyle(filters.category.includes(c))}
                >
                  {c}
                </span>
              ))}
            </div>
          </FilterField>

          {/* 3. Status (multi-select chips) */}
          <FilterField label="Status" span={2}>
            <div style={checkboxGroupStyle}>
              {STATUS_OPTIONS.map((s) => (
                <span
                  key={s}
                  onClick={() => updateFilter("status", toggleArrayValue(filters.status, s))}
                  style={chipStyle(filters.status.includes(s))}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </span>
              ))}
            </div>
          </FilterField>

          {/* 4. Date From */}
          <FilterField label="Order Date From">
            <input
              style={inputStyle}
              type="date"
              value={filters.dateFrom}
              onChange={(e) => updateFilter("dateFrom", e.target.value)}
            />
          </FilterField>

          {/* 5. Date To */}
          <FilterField label="Order Date To">
            <input
              style={inputStyle}
              type="date"
              value={filters.dateTo}
              onChange={(e) => updateFilter("dateTo", e.target.value)}
            />
          </FilterField>

          {/* 6. Amount Min */}
          <FilterField label="Amount Min ($)">
            <input
              style={inputStyle}
              type="number"
              placeholder="0"
              value={filters.amountMin}
              onChange={(e) => updateFilter("amountMin", e.target.value)}
            />
          </FilterField>

          {/* 7. Amount Max */}
          <FilterField label="Amount Max ($)">
            <input
              style={inputStyle}
              type="number"
              placeholder="∞"
              value={filters.amountMax}
              onChange={(e) => updateFilter("amountMax", e.target.value)}
            />
          </FilterField>

          {/* 8. Payment Method (single select) */}
          <FilterField label="Payment Method">
            <select
              style={selectStyle}
              value={filters.paymentMethod}
              onChange={(e) => updateFilter("paymentMethod", e.target.value)}
            >
              <option value="">Any</option>
              {PAYMENT_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </FilterField>

          {/* 9. Shipping Region (multi-select chips) */}
          <FilterField label="Shipping Region" span={2}>
            <div style={checkboxGroupStyle}>
              {REGION_OPTIONS.map((r) => (
                <span
                  key={r}
                  onClick={() => updateFilter("shippingRegion", toggleArrayValue(filters.shippingRegion, r))}
                  style={chipStyle(filters.shippingRegion.includes(r))}
                >
                  {r}
                </span>
              ))}
            </div>
          </FilterField>

          {/* 10. Coupon Used (toggle) */}
          <FilterField label="Coupon Used">
            <div style={{ display: "flex", gap: 4 }}>
              {(["any", "yes", "no"] as const).map((v) => (
                <span
                  key={v}
                  onClick={() => updateFilter("couponUsed", v)}
                  style={radioStyle(filters.couponUsed === v)}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </span>
              ))}
            </div>
          </FilterField>

          {/* 11. Rating (single select) */}
          <FilterField label="Rating">
            <select
              style={selectStyle}
              value={filters.rating}
              onChange={(e) => updateFilter("rating", e.target.value)}
            >
              {RATING_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </FilterField>

          {/* 12. Platform (multi-select chips) */}
          <FilterField label="Platform">
            <div style={checkboxGroupStyle}>
              {PLATFORM_OPTIONS.map((p) => (
                <span
                  key={p.value}
                  onClick={() => updateFilter("platform", toggleArrayValue(filters.platform, p.value))}
                  style={chipStyle(filters.platform.includes(p.value))}
                >
                  {p.label}
                </span>
              ))}
            </div>
          </FilterField>

          {/* 13. Fulfillment (radio group) */}
          <FilterField label="Fulfillment">
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {FULFILLMENT_OPTIONS.map((f) => (
                <span
                  key={f.value}
                  onClick={() => updateFilter("fulfillment", f.value)}
                  style={radioStyle(filters.fulfillment === f.value)}
                >
                  {f.label}
                </span>
              ))}
            </div>
          </FilterField>
        </div>
      </div>

      {/* Results count */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b" }}>
        <span style={{ fontWeight: 700, color: "#1e293b", fontSize: 14 }}>{filteredOrders.length}</span>
        {strings.tableShowingResults}
        <span style={{ color: "#94a3b8" }}>{strings.tableOf}</span>
        <span>{totalOrders}</span>
        {strings.tableOrders}
      </div>

      {/* Data Table */}
      <div
        style={{
          flex: 1,
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          background: "#fff",
          overflow: "auto",
          minHeight: 200,
        }}
      >
        {filteredOrders.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 12,
              color: "#94a3b8",
              padding: 40,
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <span style={{ fontSize: 13 }}>{strings.tableEmpty}</span>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e2e8f0", background: "#f8fafc" }}>
                {["Order ID", "Customer", "Product", "Category", "Status", "Date", "Amount", "Payment", "Region", "Platform", "Fulfillment", "Qty", "Rating", "Coupon"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 10px",
                      textAlign: "left",
                      fontWeight: 600,
                      color: "#475569",
                      whiteSpace: "nowrap",
                      position: "sticky",
                      top: 0,
                      background: "#f8fafc",
                      zIndex: 1,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
                const sc = STATUS_COLORS[order.status] ?? STATUS_COLORS.processing;
                return (
                  <tr key={order.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={cellStyle}><span style={{ fontWeight: 600, color: "#1e293b" }}>{order.id}</span></td>
                    <td style={cellStyle}>{order.customer}</td>
                    <td style={{ ...cellStyle, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.product}</td>
                    <td style={cellStyle}>{order.category}</td>
                    <td style={cellStyle}>
                      <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, background: sc.bg, color: sc.text }}>
                        {order.status}
                      </span>
                    </td>
                    <td style={cellStyle}>{order.orderDate}</td>
                    <td style={{ ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${order.amount.toFixed(2)}</td>
                    <td style={cellStyle}>{formatPayment(order.paymentMethod)}</td>
                    <td style={cellStyle}>{order.shippingRegion}</td>
                    <td style={cellStyle}>{formatPlatform(order.platform)}</td>
                    <td style={cellStyle}>{order.fulfillment}</td>
                    <td style={{ ...cellStyle, textAlign: "center" }}>{order.quantity}</td>
                    <td style={{ ...cellStyle, textAlign: "center" }}>{order.rating !== null ? "★".repeat(order.rating) : "—"}</td>
                    <td style={{ ...cellStyle, textAlign: "center" }}>{order.couponUsed ? "Yes" : "No"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FilterField({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={{ gridColumn: span > 1 ? `span ${span}` : undefined, display: "flex", flexDirection: "column" }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const cellStyle: React.CSSProperties = {
  padding: "8px 10px",
  color: "#475569",
  whiteSpace: "nowrap",
};

function formatPayment(m: string): string {
  const map: Record<string, string> = { credit_card: "Card", paypal: "PayPal", bank_transfer: "Bank", crypto: "Crypto" };
  return map[m] ?? m;
}

function formatPlatform(p: string): string {
  const map: Record<string, string> = { web: "Web", mobile_ios: "iOS", mobile_android: "Android" };
  return map[p] ?? p;
}

function countActiveFilters(f: OrderFilters): number {
  let n = 0;
  if (f.search) n++;
  if (f.category.length > 0) n++;
  if (f.status.length > 0) n++;
  if (f.dateFrom) n++;
  if (f.dateTo) n++;
  if (f.amountMin) n++;
  if (f.amountMax) n++;
  if (f.paymentMethod) n++;
  if (f.shippingRegion.length > 0) n++;
  if (f.couponUsed !== "any") n++;
  if (f.rating) n++;
  if (f.platform.length > 0) n++;
  if (f.fulfillment) n++;
  return n;
}

# Real tariffs

Put your DISCOM's rates in `<site_id>.json` (for example `home-mathura.json`) and the EMS uses them instead of the
illustrative presets. Copy `template.json`, replace every number with the figures from the latest bill or the
regulator's tariff order, and keep `"name"` descriptive.

Hours are local time, end exclusive, and the blocks must cover all 24 hours. Rates are INR/kWh.
`export_rate` is the net-metering or feed-in credit, `p2p_charges` the wheeling and platform charge on a P2P sale.

Optional `"meta"` block (ignored by the Python EMS, read by the platform seeder): `state` (ISO code such as MH), `discom`,
`category`, `consumerType`, `tariffYear`, `effectiveFrom` / `effectiveTo` (dates, null when the source does not say),
`fixedCharge` (`amountInr` and `basis`), `exportRateBasis` (say ASSUMPTION when the order states no export rate),
`meteringMode` and `notes`. The platform shows an order whose `effectiveTo` has passed as EXPIRED. Run
`pnpm -C platform/api db:seed` after editing.

Optional field `"p2p_share"` (default 0.55): where the assumed P2P clearing price sits between the export rate (0) and the retail rate (1).
It is an assumption, not market data, because no P2P market prices were available.

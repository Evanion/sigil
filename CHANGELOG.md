# Changelog

## [0.1.1](https://github.com/Evanion/sigil/compare/v0.1.0...v0.1.1) (2026-04-23)


### Features

* add tools and interactions — select, create shapes, drag to move (Plan 04b) ([#15](https://github.com/Evanion/sigil/issues/15)) ([2f9247a](https://github.com/Evanion/sigil/commit/2f9247a182fd2c1b98c5209109479918627ea02f))
* client-side undo/redo — all mutations emit Operations, server undo removed (Plan 15c) ([#38](https://github.com/Evanion/sigil/issues/38)) ([d5e7631](https://github.com/Evanion/sigil/commit/d5e76318235c71e6225f013384efc29ebff320ae))
* color picker component — 4 color spaces, gradient editor (Plan 09b) ([#29](https://github.com/Evanion/sigil/issues/29)) ([9cbb33c](https://github.com/Evanion/sigil/commit/9cbb33c265a4b0c500dbf15905e0a2867bb46b2e))
* **core:** add component model with overrides and variants (Plan 01e) ([#9](https://github.com/Evanion/sigil/issues/9)) ([b78c7bf](https://github.com/Evanion/sigil/commit/b78c7bfa28bcef8bbe234254caacf4609f813dc2))
* **core:** add path, grid layout, and transition types (Plan 01c) ([#7](https://github.com/Evanion/sigil/issues/7)) ([09d7289](https://github.com/Evanion/sigil/commit/09d7289484b78ad7fa34312a36b3da0081ea5044))
* **core:** add token model with alias resolution (Plan 01d) ([#8](https://github.com/Evanion/sigil/issues/8)) ([2ced3e7](https://github.com/Evanion/sigil/commit/2ced3e78fc83b55ba72d2aa05725169990944c21))
* **core:** add transition, token, and component commands (Plan 01f) ([#10](https://github.com/Evanion/sigil/issues/10)) ([e25944d](https://github.com/Evanion/sigil/commit/e25944d424dc1475e59865f51a0280db460362ad))
* **core:** add wire formats and boolean path operations (Plan 01g) ([#11](https://github.com/Evanion/sigil/issues/11)) ([52aea50](https://github.com/Evanion/sigil/commit/52aea50a4b561e2628bd5ba5e372b50b9235b1d2))
* **core:** implement command system with undo/redo (Plan 01b) ([#6](https://github.com/Evanion/sigil/issues/6)) ([0bf6658](https://github.com/Evanion/sigil/commit/0bf6658e439174cf13997396775a4a7c46ad620f))
* **core:** implement core engine foundation (Plan 01a) ([#4](https://github.com/Evanion/sigil/issues/4)) ([8917da4](https://github.com/Evanion/sigil/commit/8917da4e1ffa785495684906f91e0431c67a6486))
* enhanced token input with syntax highlighting and autocomplete (Spec 13e) ([#56](https://github.com/Evanion/sigil/issues/56)) ([e81d5c5](https://github.com/Evanion/sigil/commit/e81d5c57b3538de7f0ed9d5bd4c3be1ec2fc32a1))
* expression engine + atomic rename (Spec 13d) ([#55](https://github.com/Evanion/sigil/issues/55)) ([f4f7d55](https://github.com/Evanion/sigil/commit/f4f7d55b4922d76a27b929a61fc67329e053fb0b))
* frontend GraphQL migration + server REST/WS cleanup ([#19](https://github.com/Evanion/sigil/issues/19)) ([ef4bcc5](https://github.com/Evanion/sigil/commit/ef4bcc524c8d88da4568ec3b140c57de72fd66bf))
* **frontend:** add canvas editor foundation with WebSocket sync (Plan 04a) ([#14](https://github.com/Evanion/sigil/issues/14)) ([d754a50](https://github.com/Evanion/sigil/commit/d754a500d15f055cd78cbba850c7965626687d1a))
* **frontend:** add component library scaffold — Solid.js, Kobalte, Open Props, Storybook (Plan 07a) ([#17](https://github.com/Evanion/sigil/issues/17)) ([9f3a388](https://github.com/Evanion/sigil/commit/9f3a388e34c54827da0cbe093625d0fa91d9301f))
* **frontend:** component library — inputs, overlays, menubar (Plans 07b+07c) ([#20](https://github.com/Evanion/sigil/issues/20)) ([cfc5230](https://github.com/Evanion/sigil/commit/cfc5230b10cc67a727fdb29377e73bbeddbe9a27))
* **frontend:** DnD infrastructure — dnd-kit-solid, tree insertion logic (Plan 10a) ([#25](https://github.com/Evanion/sigil/issues/25)) ([8603fcf](https://github.com/Evanion/sigil/commit/8603fcfdb5be629187093a427f0d2c33dcf8a561))
* **frontend:** migrate shell to Solid.js + document store rewrite (Plan 08a) ([#23](https://github.com/Evanion/sigil/issues/23)) ([a8366ef](https://github.com/Evanion/sigil/commit/a8366efca2bbf242208ae73b8aabcc4fba0eb291))
* **frontend:** schema-driven panel system with tabbed regions (Plan 08b) ([#24](https://github.com/Evanion/sigil/issues/24)) ([19f09ac](https://github.com/Evanion/sigil/commit/19f09acfd1e30d6332eb6acdd87f7e29490020c4))
* **frontend:** token binding UX with ValueInput (spec-13c) ([#57](https://github.com/Evanion/sigil/issues/57)) ([d7cbd34](https://github.com/Evanion/sigil/commit/d7cbd3403261cf70fb146b13e4f9d90217ba76fc))
* gradient fill editing — stop editor, type switching, canvas rendering (Spec 09d+09e) ([#52](https://github.com/Evanion/sigil/issues/52)) ([a8a1eeb](https://github.com/Evanion/sigil/commit/a8a1eeb34ab947bf4e7f463653de609a43e28749))
* i18n infrastructure + 3 locales + migrate 97 strings (Spec 12) ([#51](https://github.com/Evanion/sigil/issues/51)) ([d2c536f](https://github.com/Evanion/sigil/commit/d2c536fdf531a6dda3462d81393efcf54960fe7f))
* layers panel with tree view, DnD, keyboard navigation (Plan 10b) ([#26](https://github.com/Evanion/sigil/issues/26)) ([2bce88e](https://github.com/Evanion/sigil/commit/2bce88e573dcdd669fcc775433a49deec085aeda))
* MCP broadcast parity + text tools + text-shadow (Spec 03b) ([#47](https://github.com/Evanion/sigil/issues/47)) ([d079d7d](https://github.com/Evanion/sigil/commit/d079d7d8f5e07e90fdfc5e4f47bef028edffc448))
* **mcp:** add MCP server — tools, resources, state extraction (Plan 03a) ([#22](https://github.com/Evanion/sigil/issues/22)) ([48450a6](https://github.com/Evanion/sigil/commit/48450a6fa4234159aea58a075e92ce77cefea99a))
* multi-select, align/distribute, group/ungroup UI (Plan 11a-c) ([#35](https://github.com/Evanion/sigil/issues/35)) ([13e097b](https://github.com/Evanion/sigil/commit/13e097bfacceeebebd30b72ea8ff32a5d387e5d8))
* operation broadcast subscription — direct store patching, no refetch (Plan 15b) ([#37](https://github.com/Evanion/sigil/issues/37)) ([39af3e0](https://github.com/Evanion/sigil/commit/39af3e0756e97f22ce01f880c96602be3f615ceb))
* operation types + HistoryManager + IndexedDB persistence (Plan 15a) ([#36](https://github.com/Evanion/sigil/issues/36)) ([ea8500a](https://github.com/Evanion/sigil/commit/ea8500a035f1cf37aa6a18b6408d39eb06539c28))
* pages panel with thumbnails, DnD, CRUD, undo/redo (Spec 10c) ([#48](https://github.com/Evanion/sigil/issues/48)) ([753a7ae](https://github.com/Evanion/sigil/commit/753a7aea7afb42360fa65fe13404b63c9195ec69))
* properties panel UI — sub-tabs, fills, strokes, effects (Plan 09c) ([#30](https://github.com/Evanion/sigil/issues/30)) ([d4f1fb3](https://github.com/Evanion/sigil/commit/d4f1fb32687f7a1b6f167372b7fba239c09bda2f))
* resize handles + smart guide snapping (Plan 11a-b) ([#34](https://github.com/Evanion/sigil/issues/34)) ([40c351e](https://github.com/Evanion/sigil/commit/40c351e21b301ff7fb62a389c5dfb53aa373d6b4))
* **server:** add GraphQL API — queries, mutations, subscriptions (Plan 02d) ([#18](https://github.com/Evanion/sigil/issues/18)) ([502b180](https://github.com/Evanion/sigil/commit/502b180366adbf2d7fb4823dd15b7c5566177cb7))
* **server:** add WebSocket command dispatch and real-time broadcast (Plan 02a) ([#12](https://github.com/Evanion/sigil/issues/12)) ([8e90440](https://github.com/Evanion/sigil/commit/8e90440ed094f7cd7b5fdbe683508c83a87343fc))
* **server:** add workfile persistence with debounced saves (Plan 02b) ([#13](https://github.com/Evanion/sigil/issues/13)) ([7f7445b](https://github.com/Evanion/sigil/commit/7f7445b2f6415f9f68f8bbaa3dc15e691d713a3c))
* style property mutations — backend + store (Plan 09a) ([#28](https://github.com/Evanion/sigil/issues/28)) ([5c0f4c0](https://github.com/Evanion/sigil/commit/5c0f4c0c1f4ab238fa1fdacdb74875b410981e27))
* text tool — create, edit, render, typography panel (Spec 11b) ([#46](https://github.com/Evanion/sigil/issues/46)) ([cf49e80](https://github.com/Evanion/sigil/commit/cf49e80e4c3e51a7f34b3bcbec9037840656cbf3))
* three-pane token management UI + native popover/dialog (Spec 13b) ([#54](https://github.com/Evanion/sigil/issues/54)) ([0d98fbc](https://github.com/Evanion/sigil/commit/0d98fbc4067123f1091e5de60bf12c02167f6cbb))
* toolchain setup with hello world deployment ([#1](https://github.com/Evanion/sigil/issues/1)) ([d7e1be1](https://github.com/Evanion/sigil/commit/d7e1be159f19e229b3457d2c17f7110525fee96c))
* viewport interactions backend — batch transform, group/ungroup, multi-select (Plan 11a-a) ([#33](https://github.com/Evanion/sigil/issues/33)) ([228461d](https://github.com/Evanion/sigil/commit/228461dc956c202589ef88a74de00f7f8e5b90f5))


### Bug Fixes

* **frontend:** add opacity, stroke, and blend mode to canvas renderer ([#42](https://github.com/Evanion/sigil/issues/42)) ([4844be9](https://github.com/Evanion/sigil/commit/4844be9da7def4dc2e3e9cc2a5d43bd006201afd))
* **frontend:** canvas z-order matches layer tree hierarchy ([#50](https://github.com/Evanion/sigil/issues/50)) ([7b77acd](https://github.com/Evanion/sigil/commit/7b77acd30efa4ae4f926151b930b8d5de4ebe192))
* PR [#26](https://github.com/Evanion/sigil/issues/26) post-merge review — remediation + governance ([#27](https://github.com/Evanion/sigil/issues/27)) ([3d8e726](https://github.com/Evanion/sigil/commit/3d8e726c8ad967dc89902febdce4385ffbaaa5c3))
* undo/redo — re-fetch state, case-insensitive keys, tinykeys, initial_transform ([#16](https://github.com/Evanion/sigil/issues/16)) ([a293f3c](https://github.com/Evanion/sigil/commit/a293f3c74e876175b554b70d5b7fea5d1ab26a53))

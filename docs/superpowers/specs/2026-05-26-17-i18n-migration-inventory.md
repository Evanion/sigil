# Spec 17 — i18n Migration Inventory (snapshot)

Generated: 2026-05-26
Source: `pnpm --prefix frontend exec eslint --format json src/` filtered to `i18next/no-literal-string` (the ESLint compact formatter is no longer in core; JSON output was reformatted into a compact-style `file: line N, col N, Severity - message (rule)` listing).

Total entries: 36

## Violations

```
frontend/src/components/color-picker/AlphaStrip.tsx: line 183, col 8, Warning - disallow literal string: <canvas         ref={canvasRef}         class="sigil-strip__canvas"         aria-hidden="true"         style={{ width: "100%", height: `${STRIP_HEIGHT}px` }}       >         Opacity selection strip       </canvas> (i18next/no-literal-string)
frontend/src/components/color-picker/ColorArea.tsx: line 208, col 58, Warning - disallow literal string: <canvas         ref={canvasRef}         class="sigil-color-area__canvas"         aria-hidden="true"         style={{ width: "100%", height: `${areaHeight()}px` }}       >         {/* Fallback text for non-canvas environments */}         Color selection area       </canvas> (i18next/no-literal-string)
frontend/src/components/color-picker/GradientEditor.tsx: line 350, col 60, Warning - disallow literal string: <span class="sigil-gradient-editor__angle-label">Angle</span> (i18next/no-literal-string)
frontend/src/components/color-picker/HexInput.tsx: line 117, col 10, Warning - disallow literal string: <span           class="sigil-hex-input__gamut-warning"           title="Color is outside the sRGB gamut"           aria-label="Out of sRGB gamut"           role="img"         >           ⚠         </span> (i18next/no-literal-string)
frontend/src/components/color-picker/HueStrip.tsx: line 185, col 8, Warning - disallow literal string: <canvas         ref={canvasRef}         class="sigil-strip__canvas"         aria-hidden="true"         style={{ width: "100%", height: `${STRIP_HEIGHT}px` }}       >         Hue selection strip       </canvas> (i18next/no-literal-string)
frontend/src/components/value-input/ValueInput.tsx: line 1068, col 53, Warning - disallow literal string: <span class="sigil-token-input__resolved">= {evalResult().resolved}</span> (i18next/no-literal-string)
frontend/src/panels/AlignPanel.tsx: line 100, col 56, Warning - disallow literal string: <span class="sigil-align-panel__section-title">Align</span> (i18next/no-literal-string)
frontend/src/panels/AlignPanel.tsx: line 165, col 56, Warning - disallow literal string: <span class="sigil-align-panel__section-title">Distribute</span> (i18next/no-literal-string)
frontend/src/panels/AppearancePanel.tsx: line 397, col 90, Warning - disallow literal string: <span class="sigil-appearance-panel__section-title" id="appearance-fill-title">             Fill           </span> (i18next/no-literal-string)
frontend/src/panels/AppearancePanel.tsx: line 406, col 12, Warning - disallow literal string: <button             class="sigil-appearance-panel__add"             type="button"             aria-label="Add fill"             disabled={selectedUuid() === null}             onClick={handleAddFill}           >             +           </button> (i18next/no-literal-string)
frontend/src/panels/AppearancePanel.tsx: line 412, col 52, Warning - disallow literal string: <p class="sigil-appearance-panel__empty">No fills</p> (i18next/no-literal-string)
frontend/src/panels/AppearancePanel.tsx: line 445, col 92, Warning - disallow literal string: <span class="sigil-appearance-panel__section-title" id="appearance-stroke-title">             Stroke           </span> (i18next/no-literal-string)
frontend/src/panels/AppearancePanel.tsx: line 454, col 12, Warning - disallow literal string: <button             class="sigil-appearance-panel__add"             type="button"             aria-label="Add stroke"             disabled={selectedUuid() === null}             onClick={handleAddStroke}           >             +           </button> (i18next/no-literal-string)
frontend/src/panels/AppearancePanel.tsx: line 460, col 52, Warning - disallow literal string: <p class="sigil-appearance-panel__empty">No strokes</p> (i18next/no-literal-string)
frontend/src/panels/EffectCard.tsx: line 337, col 39, Warning - disallow literal string: <option value="drop_shadow">Drop Shadow</option> (i18next/no-literal-string)
frontend/src/panels/EffectCard.tsx: line 338, col 40, Warning - disallow literal string: <option value="inner_shadow">Inner Shadow</option> (i18next/no-literal-string)
frontend/src/panels/EffectCard.tsx: line 339, col 38, Warning - disallow literal string: <option value="layer_blur">Layer Blur</option> (i18next/no-literal-string)
frontend/src/panels/EffectCard.tsx: line 340, col 43, Warning - disallow literal string: <option value="background_blur">Background Blur</option> (i18next/no-literal-string)
frontend/src/panels/EffectCard.tsx: line 349, col 10, Warning - disallow literal string: <button           class="sigil-effect-card__remove"           type="button"           tabIndex={-1}           aria-label="Remove effect"           onClick={handleRemove}         >           ×         </button> (i18next/no-literal-string)
frontend/src/panels/EffectCard.tsx: line 388, col 78, Warning - disallow literal string: <span class="sigil-effect-card__field-prefix" aria-hidden="true">               X             </span> (i18next/no-literal-string)
frontend/src/panels/EffectCard.tsx: line 401, col 78, Warning - disallow literal string: <span class="sigil-effect-card__field-prefix" aria-hidden="true">               Y             </span> (i18next/no-literal-string)
frontend/src/panels/EffectCard.tsx: line 414, col 78, Warning - disallow literal string: <span class="sigil-effect-card__field-prefix" aria-hidden="true">               B             </span> (i18next/no-literal-string)
frontend/src/panels/EffectCard.tsx: line 427, col 78, Warning - disallow literal string: <span class="sigil-effect-card__field-prefix" aria-hidden="true">               S             </span> (i18next/no-literal-string)
frontend/src/panels/EffectsPanel.tsx: line 149, col 50, Warning - disallow literal string: <span class="sigil-effects-panel__title">Effects</span> (i18next/no-literal-string)
frontend/src/panels/EffectsPanel.tsx: line 156, col 10, Warning - disallow literal string: <button           class="sigil-effects-panel__add"           type="button"           aria-label="Add effect"           disabled={selectedUuid() === null}           onClick={handleAdd}         >           +         </button> (i18next/no-literal-string)
frontend/src/panels/EffectsPanel.tsx: line 162, col 47, Warning - disallow literal string: <p class="sigil-effects-panel__empty">Select a layer to edit effects.</p> (i18next/no-literal-string)
frontend/src/panels/EffectsPanel.tsx: line 166, col 47, Warning - disallow literal string: <p class="sigil-effects-panel__empty">No effects</p> (i18next/no-literal-string)
frontend/src/panels/StrokeRow.tsx: line 126, col 8, Warning - disallow literal string: <button         class="sigil-stroke-row__remove"         type="button"         tabIndex={-1}         aria-label="Remove stroke"         onClick={handleRemove}       >         ×       </button> (i18next/no-literal-string)
frontend/src/panels/corner-section/CornerPopover.tsx: line 597, col 70, Warning - disallow literal string: <label id={shapeLabelId} class="sigil-corner-popover__label">           Shape         </label> (i18next/no-literal-string)
frontend/src/panels/corner-section/CornerPopover.tsx: line 605, col 12, Warning - disallow literal string: <span             id={mixedId}             class="sigil-corner-popover__mixed"             data-testid="corner-popover__mixed-indicator"           >             Mixed           </span> (i18next/no-literal-string)
frontend/src/panels/corner-section/CornerPopover.tsx: line 733, col 80, Warning - disallow literal string: <label id={smoothingLabelId} class="sigil-corner-popover__label">                 Smoothing               </label> (i18next/no-literal-string)
frontend/src/panels/corner-section/CornerSection.tsx: line 156, col 48, Warning - disallow literal string: <h3 class="sigil-corner-section__header">Corners</h3> (i18next/no-literal-string)
frontend/src/panels/token-editor/TokenDetailPane.tsx: line 200, col 14, Warning - disallow literal string: <span               style={{                 "font-family": `${fontFamily}, sans-serif`,                 "font-size": `${fontSize}px`,                 "font-weight": String(fontWeight),               }}             >               Aa             </span> (i18next/no-literal-string)
frontend/src/panels/token-editor/TokenNavigationPane.tsx: line 123, col 8, Warning - disallow literal string: <button         class="sigil-token-nav__create-button"         type="button"         onClick={() => props.onCreateToken()}       >         + {t("panels:tokens.newToken")}       </button> (i18next/no-literal-string)
frontend/src/shell/StatusBar.tsx: line 32, col 30, Warning - disallow literal string: <span>{zoomPercent()}%</span> (i18next/no-literal-string)
frontend/src/shell/Toolbar.tsx: line 150, col 53, Warning - disallow literal string: <div class="toolbar__logo" aria-hidden="true">         SIGIL       </div> (i18next/no-literal-string)
```

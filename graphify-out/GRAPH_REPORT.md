# Graph Report - cairn  (2026-08-22)

## Corpus Check
- 106 files · ~793,773 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4078 nodes · 12477 edges · 231 communities (190 shown, 41 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 764 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2980bc07`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- cairn-engine.js
- Ob
- "node_modules/elkjs/lib/elk.bundled.js"
- edge-tidy.ts
- xn
- Xb
- O
- engine.node.mjs
- Hi
- flow-matrix.ts
- Gc
- route-detour.ts
- Ug
- Readability metrics
- biome.json
- uo
- parser.ts
- Pd
- svg-render.ts
- layout
- gn
- i$n
- Nt
- lxe
- scene-layout.ts
- Nd
- mc
- readability.ts
- slide-fold.ts
- et
- Kc
- SceneNode
- label-anchor.ts
- ue
- sweep.ts
- lo
- Po
- Ei
- validator.ts
- ao
- sideOf
- ARCHITECTURE.md
- Ot
- cli.ts
- Alternative layout engines — evaluation
- D
- rerouteDetours
- edge
- cu
- v3
- lj
- ie
- bxe
- Dr
- xIe
- P
- kd
- corpus.ts
- Wi
- compilerOptions
- Yi
- straightenAndCollapseEdge
- Non-negotiable invariants
- package.json
- ah
- u4
- wr
- scripts
- ln
- straightenAndCollapseEdge
- package.json
- Yu
- bs
- Cairn, a specialized Software Architecture Diagram as Code tool
- Su
- foldedLayout
- prototype.js
- jc
- Xu
- so
- hr
- devDependencies
- Eclipse Public License - v 2.0
- categories
- Gh
- Vu
- lOn
- validate
- behavior.test.ts
- CONTRIBUTING.md
- compile
- w3
- Xr
- unweaveEdge
- CLEAN_CODE.md
- 4. Flow labels
- jN
- Ar
- Yr
- lc
- Entry point for AI Agents
- DSL Spec
- sidehug.test.ts
- fOn
- r$n
- qA
- anchorFlowLabels
- unweaveAndClearContainers
- Releasing cairn
- WORKING METHODOLOGY
- Architecture
- Ad
- R1
- Dc
- Ub
- Preview
- trySwapSeats
- Testing cairn
- $1
- xd
- y3
- Wk
- Ea
- Xi
- n4
- pc
- x1
- package.json
- Contributing to cairn
- keywords
- x2
- $ge
- zje
- nEe
- dNn
- trySwapSeats
- vercel.json
- render-packaging.mjs
- Flow routing implementation reference
- Playground bundles
- files
- qze
- p9n
- ka
- Qc
- eR
- zBe
- zb
- fj
- wUe
- cairn playground
- cairn.js
- Debug Issue
- Explore Codebase
- Refactor Safely
- Review Changes
- How flow routing works
- bench-elkjs.js
- p$e
- Nf
- c7n
- ydn
- t3
- ur
- x8n
- shiftAttachment
- d2-baseline.mjs
- Cairn
- aBe
- b$e
- vpn
- Y6
- r8
- nTe
- render-examples.mjs
- code-review-graph
- Bd
- aIe
- nV
- cNe
- uFe
- rze
- sr
- oFe
- epn
- eRn
- gpn
- gFe
- gTn
- jgn
- tM
- rqe
- smoke-binary.sh
- infrastructure.flow.md
- infrastructure-fr.flow.md
- README.md
- install.sh
- k$e
- fgn
- bFe
- txe
- x3n
- cBe
- cV
- cX
- d$e
- fNe
- wDe
- gj
- h2n
- iCe
- jBe
- jT
- k0n
- lK
- m8
- n8n
- o$e
- q7n
- qje
- s3n
- Uk
- yj
- build-api.sh
- build-binaries.sh
- build-cli.sh
- build-playground.sh
- render-examples.sh script
- smoke-npm.sh
- update-snapshots.mjs
- playground.test.ts

## God Nodes (most connected - your core abstractions)
1. `"node_modules/elkjs/lib/elk.bundled.js"()` - 356 edges
2. `O()` - 326 edges
3. `Ob()` - 264 edges
4. `Pb()` - 263 edges
5. `Ug()` - 117 edges
6. `gn()` - 91 edges
7. `Xb()` - 91 edges
8. `ln()` - 88 edges
9. `xn()` - 87 edges
10. `Gc()` - 84 edges

## Surprising Connections (you probably didn't know these)
- `tagOrder()` --indirect_call--> `at()`  [INFERRED]
  scripts/sweep.ts → playground/cairn-engine.js
- `watchCommand()` --indirect_call--> `scene()`  [INFERRED]
  src/watch.ts → tests/sidehug.test.ts
- `J_n()` --indirect_call--> `h()`  [INFERRED]
  playground/cairn-engine.js → tests/corpus.ts
- `san()` --indirect_call--> `h()`  [INFERRED]
  playground/cairn-engine.js → tests/corpus.ts
- `pan()` --indirect_call--> `h()`  [INFERRED]
  playground/cairn-engine.js → tests/corpus.ts

## Import Cycles
- None detected.

## Communities (231 total, 41 thin omitted)

### Community 0 - "cairn-engine.js"
Cohesion: 0.00
Nodes (65): $2n(), a3n(), a5n(), alloc(), Az(), bEn(), byn(), c$() (+57 more)

### Community 1 - "Ob"
Cohesion: 0.05
Nodes (108): $6n(), Ac(), ajn(), aqe(), b3(), bjn(), bNn(), bqe() (+100 more)

### Community 2 - ""node_modules/elkjs/lib/elk.bundled.js""
Cohesion: 0.02
Nodes (102): Ap(), ave(), aye(), bAe(), bBe(), bDe(), bve(), bye() (+94 more)

### Community 3 - "edge-tidy.ts"
Cohesion: 0.06
Nodes (67): attemptHugFix(), buildResideRoute(), clampTerminalsToBorders(), clearEdgeHugs(), clearRunHug(), collapsedPolylineOk(), CollapseGuards, collapseOneJog() (+59 more)

### Community 4 - "xn"
Cohesion: 0.05
Nodes (71): $3(), aSn(), at(), axn(), b9n(), bCn(), bLn(), bze() (+63 more)

### Community 5 - "Xb"
Cohesion: 0.05
Nodes (71): $8(), Ab(), aTe(), b7(), bpn(), d$n(), dT(), emn() (+63 more)

### Community 6 - "O"
Cohesion: 0.04
Nodes (64): a6n(), aEe(), bSe(), cDe(), cEe(), cUe(), d2(), d6n() (+56 more)

### Community 7 - "engine.node.mjs"
Cohesion: 0.06
Nodes (57): applyDeclaredPorts(), assignSourceHues(), attemptHugFix(), auditRouteRepairs(), bestSingleRoute(), boundsOf2(), buildElkGraph(), buildGroupGraph() (+49 more)

### Community 8 - "Hi"
Cohesion: 0.05
Nodes (59): aCn(), au(), aUe(), ban(), bQ(), cqe(), cxe(), Dd() (+51 more)

### Community 9 - "flow-matrix.ts"
Cohesion: 0.06
Nodes (49): compile(), CompileOptions, CompileResult, buildFlowMatrix(), COLUMN_PRESENTATION, columnLabel(), csvCell(), endpoint() (+41 more)

### Community 10 - "Gc"
Cohesion: 0.06
Nodes (54): $8n(), aHe(), aje(), aLn(), axe(), Ca(), cOn(), e0() (+46 more)

### Community 11 - "route-detour.ts"
Cohesion: 0.08
Nodes (52): assignLanes(), Band, bandConflicts(), blockedAboveBy(), blockedBelowBy(), BottomPlan, buildBlockingBands(), centerX() (+44 more)

### Community 12 - "Ug"
Cohesion: 0.07
Nodes (48): age(), aTn(), Bi(), bje(), bOn(), bRe(), Bu(), cLn() (+40 more)

### Community 13 - "Readability metrics"
Cohesion: 0.04
Nodes (47): A known gap, Adding a metric, `attachAway` · ratchet, `attachShared` · must be 0, `attachTight` · ratchet, Changing a ceiling, `coincident` · must be 0, `crossings` · ratchet (+39 more)

### Community 14 - "biome.json"
Cohesion: 0.05
Nodes (42): source, assist, actions, noExcessiveCognitiveComplexity, noExcessiveLinesPerFunction, noForEach, useMaxParams, files (+34 more)

### Community 15 - "uo"
Cohesion: 0.05
Nodes (43): $0n(), b0n(), b2n(), bke(), c2n(), c8n(), cEn(), d8n() (+35 more)

### Community 16 - "parser.ts"
Cohesion: 0.11
Nodes (34): applyStyleEntry(), isIdChar(), lex(), SINGLE_CHAR_TOKENS, ATTACH_SIDES, AttachSide, BusinessObject, defaultDiagramStyle() (+26 more)

### Community 17 - "Pd"
Cohesion: 0.05
Nodes (40): a3(), agn(), b3n(), Cd(), Cz(), d5n(), dAe(), dEn() (+32 more)

### Community 18 - "svg-render.ts"
Cohesion: 0.13
Nodes (36): own(), labelsSeated(), matrixSvg(), boundsOf(), boxesOverlap(), boxGapSq(), elkFlowEdge(), connectorLabel() (+28 more)

### Community 19 - "layout"
Cohesion: 0.07
Nodes (38): attachAwayOf(), checkIsolatedElements(), clearEdgeHugs(), clearSideHugs(), collectSceneEdges(), compactVertical(), computeIngressExternalElements(), constrainPorts() (+30 more)

### Community 20 - "gn"
Cohesion: 0.14
Nodes (36): apn(), cCn(), cpn(), dpn(), dTn(), eIe(), eOn(), F1() (+28 more)

### Community 21 - "i$n"
Cohesion: 0.09
Nodes (34): abn(), aL(), Bhn(), cl(), co(), Dhn(), eK(), fbn() (+26 more)

### Community 22 - "Nt"
Cohesion: 0.10
Nodes (34): aOe(), bvn(), cze(), fjn(), gge(), gze(), hxn(), iLn() (+26 more)

### Community 23 - "lxe"
Cohesion: 0.06
Nodes (34): bHe(), bxn(), ean(), fan(), Fd(), fqe(), gLe(), iDe() (+26 more)

### Community 24 - "scene-layout.ts"
Cohesion: 0.10
Nodes (28): compactVertical(), Cut, getElk(), setElkFactory(), ElkClass, nodeElkFactory(), ElkClass, titleBoxesOf() (+20 more)

### Community 25 - "Nd"
Cohesion: 0.06
Nodes (33): $4n(), aK(), c1n(), c9e(), cT(), dY(), Eo(), f5() (+25 more)

### Community 26 - "mc"
Cohesion: 0.16
Nodes (32): a7n(), aEn(), b$n(), cf(), cN(), dmn(), eIn(), eLn() (+24 more)

### Community 27 - "readability.ts"
Cohesion: 0.11
Nodes (31): createLadderModel(), RouteSubject, Bounds, boundsOf(), Boxy, containment(), crossAt(), Ends (+23 more)

### Community 28 - "slide-fold.ts"
Cohesion: 0.13
Nodes (29): indexElementsById(), subtreeElements(), Element, LaidOutNode, buildGroupGraph(), classifyFlow(), Cls, ColGroup (+21 more)

### Community 29 - "et"
Cohesion: 0.12
Nodes (31): a8n(), bIn(), br(), cjn(), et(), fCn(), fL(), fr() (+23 more)

### Community 30 - "Kc"
Cohesion: 0.07
Nodes (31): bdn(), bkn(), cgn(), cwn(), f2n(), fEn(), fFe(), fTn() (+23 more)

### Community 31 - "SceneNode"
Cohesion: 0.10
Nodes (29): AttachGroup, Attachment, bestSingleRoute(), BlockedReside, Fan, LadderModel, LaneModel, ReaimContext (+21 more)

### Community 32 - "label-anchor.ts"
Cohesion: 0.19
Nodes (24): Box, boxToPolylineSq(), boxToSegmentSq(), TitleBox, anchorFlowLabels(), besideRunSeats(), chooseSeat(), clearAt() (+16 more)

### Community 33 - "ue"
Cohesion: 0.17
Nodes (30): a$n(), Ae(), An(), be(), Bn(), c$n(), dbn(), e$n() (+22 more)

### Community 34 - "sweep.ts"
Cohesion: 0.09
Nodes (28): baseline, BASELINE_PATH, Box, boxToPolylineSq(), boxToSegmentSq(), CEILING_RATE, detail, DISPOSITIONS (+20 more)

### Community 35 - "lo"
Cohesion: 0.10
Nodes (29): $2(), bK(), dK(), dxe(), dxn(), e5n(), f4n(), han() (+21 more)

### Community 36 - "Po"
Cohesion: 0.10
Nodes (29): $9n(), aF(), aIn(), aY(), bge(), c3(), ckn(), dkn() (+21 more)

### Community 37 - "Ei"
Cohesion: 0.09
Nodes (29): akn(), bF(), bTn(), bY(), dyn(), Ei(), Jh(), jmn() (+21 more)

### Community 38 - "validator.ts"
Cohesion: 0.12
Nodes (25): subtreeIds(), checkBusinessObjects(), checkDuplicateIds(), checkElementAttributes(), checkFlows(), checkForbiddenBusinessObjects(), checkIsolatedElements(), checkMinimumCounts() (+17 more)

### Community 39 - "ao"
Cohesion: 0.09
Nodes (28): ao(), Dm(), eAe(), gxn(), hIe(), Hm(), i3n(), iEe() (+20 more)

### Community 40 - "sideOf"
Cohesion: 0.10
Nodes (28): buildResideRoute(), clearRunHug(), disturbsNeighbourSeats(), gainedCrossings(), generateReaimCandidates(), hasShortInterior(), interiorRiserIndex(), labelsRideRoute() (+20 more)

### Community 41 - "ARCHITECTURE.md"
Cohesion: 0.13
Nodes (17): Boundaries, Commands you can use, Documentation practices, Persona, Project knowledge, Your role, Boundaries, Commands you can use (+9 more)

### Community 42 - "Ot"
Cohesion: 0.12
Nodes (27): bmn(), cyn(), eEe(), ize(), J_n(), ju(), k1(), l0() (+19 more)

### Community 43 - "cli.ts"
Cohesion: 0.11
Nodes (20): args, exitIfErrors(), loadAndCheck(), positionalFile(), PRINT_FRAMES, resolveOutputPath(), TEMPLATES, TYPE_FLAGS (+12 more)

### Community 44 - "Alternative layout engines — evaluation"
Cohesion: 0.08
Nodes (23): Alternative layout engines — evaluation, Custom engine from scratch, dagre, External references, Graphviz, Mermaid, PlantUML, Summary (+15 more)

### Community 45 - "D"
Cohesion: 0.12
Nodes (26): B(), cbn(), D(), ddn(), F(), f$n(), gbn(), gRn() (+18 more)

### Community 46 - "rerouteDetours"
Cohesion: 0.09
Nodes (26): bandConflicts(), buildBlockingBands(), createChannel(), createLaneContext(), detourCandidates(), emitBottomRoute(), emitTopRoute(), findSideApproach() (+18 more)

### Community 47 - "edge"
Cohesion: 0.13
Nodes (26): clearSideHugs(), containersHolding(), createHugContext(), createLaneModel(), createReaimContext(), createSeatModel(), createTidyContext(), createUnweaveContext() (+18 more)

### Community 48 - "cu"
Cohesion: 0.10
Nodes (25): $3n(), bIe(), c0n(), cTe(), cu(), dQ(), Fh(), Gb() (+17 more)

### Community 49 - "v3"
Cohesion: 0.09
Nodes (25): a7(), avn(), c7(), cLe(), Dh(), e$e(), f7(), gwn() (+17 more)

### Community 50 - "lj"
Cohesion: 0.11
Nodes (25): aze(), b5n(), cr(), dTe(), ejn(), gkn(), gL(), h8n() (+17 more)

### Community 51 - "ie"
Cohesion: 0.13
Nodes (25): bRn(), cRn(), dRn(), ebn(), fhn(), fRn(), Ft(), G() (+17 more)

### Community 52 - "bxe"
Cohesion: 0.25
Nodes (24): Aa(), bUe(), bxe(), iEn(), ixe(), K0(), kBe(), kxe() (+16 more)

### Community 53 - "Dr"
Cohesion: 0.10
Nodes (24): aDe(), Bb(), Bh(), cRe(), Dr(), dvn(), dW(), ho() (+16 more)

### Community 54 - "xIe"
Cohesion: 0.12
Nodes (24): b2(), bA(), d3n(), fBe(), fUe(), g2(), hge(), iIe() (+16 more)

### Community 55 - "P"
Cohesion: 0.15
Nodes (24): ehn(), fdn(), GFn(), HFn(), KFn(), lbn(), mbn(), mhn() (+16 more)

### Community 56 - "kd"
Cohesion: 0.20
Nodes (24): Fm(), g4n(), g5(), hF(), Hk(), Ia(), jE(), kd() (+16 more)

### Community 57 - "corpus.ts"
Cohesion: 0.16
Nodes (21): committed, categorize(), Categorized, colorHash(), computeCorpus(), corpusFiles(), Digest, DIGEST_PATH (+13 more)

### Community 58 - "Wi"
Cohesion: 0.15
Nodes (23): aFe(), ame(), DE(), f9e(), fDe(), fOe(), Gz(), ku() (+15 more)

### Community 59 - "compilerOptions"
Cohesion: 0.09
Nodes (22): node, compilerOptions, allowImportingTsExtensions, allowUnreachableCode, erasableSyntaxOnly, forceConsistentCasingInFileNames, module, moduleResolution (+14 more)

### Community 60 - "Yi"
Cohesion: 0.14
Nodes (21): a2n(), aV(), $dn(), dpe(), gV(), h7(), k5(), mwn() (+13 more)

### Community 61 - "straightenAndCollapseEdge"
Cohesion: 0.10
Nodes (21): clampTerminalsToBorders(), collapsedPolylineOk(), collapseOneJog(), collapseSCurves(), createReaimContext(), crossingsNearNode(), dropCollinear(), dropStraightPoint() (+13 more)

### Community 62 - "Non-negotiable invariants"
Cohesion: 0.10
Nodes (20): 10. Slide / page orientation, 11. Backward flow rerouting, 12. Element kind validity per view, 13. `cairn new` must not overwrite files, 14. Snapshot & corpus gates, 15. Flow matrix export invariants, 16. Flow positioning is blind to the DSL, 17. Author positioning hints are honored, not negotiated (+12 more)

### Community 63 - "package.json"
Cohesion: 0.10
Nodes (19): bin, cairn, bugs, url, description, engines, node, exports (+11 more)

### Community 64 - "ah"
Cohesion: 0.14
Nodes (20): aan(), ah(), b8(), bCe(), bEe(), cIn(), Db(), dge() (+12 more)

### Community 65 - "u4"
Cohesion: 0.15
Nodes (19): bSn(), dNe(), evn(), h$e(), hQ(), hvn(), Mu(), mxn() (+11 more)

### Community 66 - "wr"
Cohesion: 0.20
Nodes (19): Da(), Fa(), Gd(), Go(), h$n(), iHe(), iRe(), Jf() (+11 more)

### Community 67 - "scripts"
Cohesion: 0.11
Nodes (18): scripts, build:api, build:binaries, build:cli, build:playground, cairn, examples, format (+10 more)

### Community 68 - "ln"
Cohesion: 0.16
Nodes (18): aNn(), Cc(), cTn(), di(), hNn(), hSn(), k8n(), k$n() (+10 more)

### Community 69 - "straightenAndCollapseEdge"
Cohesion: 0.22
Nodes (13): liftRunsOffTitleBands(), nestCorridorRisers(), ridesContainerBorder(), seatedLabelsExcept(), segmentGapSq(), segmentsAreClean(), segmentStrikesBand(), segmentTouchesBox() (+5 more)

### Community 70 - "package.json"
Cohesion: 0.12
Nodes (16): author, dependencies, elkjs, @resvg/resvg-js, @terrastruct/d2, description, elkjs, keywords (+8 more)

### Community 71 - "Yu"
Cohesion: 0.12
Nodes (17): aW(), b1(), dHe(), fEe(), jLe(), Or(), oX(), qb() (+9 more)

### Community 72 - "bs"
Cohesion: 0.12
Nodes (16): aCe(), aQ(), bs(), cCe(), cQ(), $h(), iTn(), jCe() (+8 more)

### Community 73 - "Cairn, a specialized Software Architecture Diagram as Code tool"
Cohesion: 0.12
Nodes (16): Cairn, a specialized Software Architecture Diagram as Code tool, Check a diagram (syntax, schema, completeness), Check your version, Commands, Explain a diagnostic, Export the flow matrix, In short,, Installation (+8 more)

### Community 74 - "Su"
Cohesion: 0.26
Nodes (15): a$(), bNe(), cY(), eme(), mRe(), ngn(), p2(), qNe() (+7 more)

### Community 75 - "foldedLayout"
Cohesion: 0.14
Nodes (15): alloc(), assignLanes(), classifyFlow(), collectFoldedEdges(), foldedLayout(), foldStyle(), indexElementsById(), layoutColumn() (+7 more)

### Community 76 - "prototype.js"
Cohesion: 0.15
Nodes (10): ELK, fs, graph, kindOf, labelOf, measure(), model, path (+2 more)

### Community 77 - "jc"
Cohesion: 0.18
Nodes (14): aRn(), hRn(), ibn(), jbn(), jc(), jRn(), lhn(), obn() (+6 more)

### Community 78 - "Xu"
Cohesion: 0.14
Nodes (14): bbn(), c9n(), e8n(), j1n(), ldn(), o9n(), odn(), oHe() (+6 more)

### Community 79 - "so"
Cohesion: 0.14
Nodes (14): c8(), dOe(), eBe(), fkn(), hD(), hDe(), l9e(), nQ() (+6 more)

### Community 80 - "hr"
Cohesion: 0.14
Nodes (14): e3n(), hr(), ign(), il(), iNe(), nEn(), o4n(), rwn() (+6 more)

### Community 81 - "devDependencies"
Cohesion: 0.15
Nodes (13): @biomejs/biome, esbuild, oxlint, devDependencies, @biomejs/biome, elkjs, esbuild, oxlint (+5 more)

### Community 82 - "Eclipse Public License - v 2.0"
Cohesion: 0.15
Nodes (11): 1. DEFINITIONS, 2. GRANT OF RIGHTS, 3. REQUIREMENTS, 4. COMMERCIAL DISTRIBUTION, 5. NO WARRANTY {#warranty}, 6. DISCLAIMER OF LIABILITY {#disclaimer}, 7. GENERAL, Eclipse Public License - v 2.0 (+3 more)

### Community 83 - "categories"
Cohesion: 0.15
Nodes (12): categories, correctness, nursery, pedantic, perf, restriction, style, suspicious (+4 more)

### Community 84 - "Gh"
Cohesion: 0.15
Nodes (13): bV(), bW(), Gh(), l1(), oEe(), rA(), rV(), ts() (+5 more)

### Community 85 - "Vu"
Cohesion: 0.15
Nodes (13): cge(), Df(), eqe(), fAe(), hTe(), hze(), I(), k3() (+5 more)

### Community 86 - "lOn"
Cohesion: 0.18
Nodes (13): h6n(), i3(), jEn(), jz(), lOn(), nc(), qs(), sEn() (+5 more)

### Community 87 - "validate"
Cohesion: 0.19
Nodes (13): checkBusinessObjects(), checkDuplicateIds(), checkElementAttributes(), checkFlows(), checkForbiddenBusinessObjects(), checkMinimumCounts(), checkMissingLabels(), checkNesting() (+5 more)

### Community 88 - "behavior.test.ts"
Cohesion: 0.18
Nodes (6): build(), check(), edgesCross(), EX, ROOT, segmentsOf()

### Community 89 - "CONTRIBUTING.md"
Cohesion: 0.24
Nodes (5): Code table, Diagnostic codes, Exit codes, JSON output (`cairn validate --format json`), Documentation index

### Community 90 - "compile"
Cohesion: 0.20
Nodes (11): errSvg(), ESCAPES, handler(), attachSideDiagnostics(), buildFlowMatrix(), compile(), lex(), parse() (+3 more)

### Community 91 - "w3"
Cohesion: 0.17
Nodes (12): aLe(), d4n(), d7(), dCe(), fV(), gan(), gmn(), hLe() (+4 more)

### Community 92 - "Xr"
Cohesion: 0.17
Nodes (12): b6n(), cHe(), eY(), f9n(), hEn(), nje(), r0(), Xr() (+4 more)

### Community 93 - "unweaveEdge"
Cohesion: 0.26
Nodes (8): bestUnweaveRoute(), fanTanglesOf(), UnweaveContext, unweaveEdge(), unweaveLabelsSeatable(), unweaveRouteAccepted(), unweaveSeatFree(), pathLength()

### Community 94 - "CLEAN_CODE.md"
Cohesion: 0.18
Nodes (10): Code smells, Comments rules, Design rules, Functions rules, General rules, Names rules, Objects and data structures, Source code structure (+2 more)

### Community 95 - "4. Flow labels"
Cohesion: 0.18
Nodes (11): 4. Flow labels, 4a. Every label belongs to a visible flow, 4b. Flows leaving one node side must not tangle in its fan, 4c. A flow's terminals face its counterpart, 4d. Labels sit **on** their flow, never beside it, 4e. Nothing is drawn across a container's name, 4f. Corridor risers nest, they do not interleave, 4g. A flow does not weave (+3 more)

### Community 96 - "jN"
Cohesion: 0.18
Nodes (11): a1n(), eEn(), jHe(), jN(), kj(), qd(), sOe(), vCn() (+3 more)

### Community 97 - "Ar"
Cohesion: 0.20
Nodes (11): a9n(), Ar(), hj(), jyn(), lpn(), qDe(), t7(), vjn() (+3 more)

### Community 98 - "Yr"
Cohesion: 0.20
Nodes (11): amn(), m4n(), pFe(), q7(), QO(), qRe(), r4n(), s4n() (+3 more)

### Community 99 - "lc"
Cohesion: 0.25
Nodes (11): C1(), e5(), gs(), hBe(), Id(), j7(), jL(), Kh() (+3 more)

### Community 100 - "Entry point for AI Agents"
Cohesion: 0.20
Nodes (10): Entry point for AI Agents, Entry points, Key Tools, MCP Tools: code-review-graph, Non-negotiable invariants, Runtime model, Specialized Roles, What cairn is (+2 more)

### Community 101 - "DSL Spec"
Cohesion: 0.20
Nodes (10): 1. Structure, 2.1 Flow matrix, 2. Styling — three levels, most specific wins, 3. Diagnostics, 4. Deferred (not v0.1), DSL design decisions (D1–D4), DSL Spec, Element nesting (+2 more)

### Community 102 - "sidehug.test.ts"
Cohesion: 0.29
Nodes (8): a1(), a2(), allCrossings(), assertInvariants(), crossCount(), hugCount(), scene(), seatOf()

### Community 103 - "fOn"
Cohesion: 0.29
Nodes (10): aAe(), fOn(), h3n(), J6(), kSn(), qyn(), rK(), tY() (+2 more)

### Community 104 - "r$n"
Cohesion: 0.24
Nodes (10): c4(), d9n(), hTn(), kTn(), Ld(), n3(), o$n(), pRe() (+2 more)

### Community 105 - "qA"
Cohesion: 0.20
Nodes (10): j1(), k3n(), oAe(), oIn(), qA(), si(), sTn(), u3() (+2 more)

### Community 106 - "anchorFlowLabels"
Cohesion: 0.27
Nodes (10): anchorFlowLabels(), besideRunSeats(), chooseSeat(), createLabelSeatContext(), hostSegment(), resolveLabelCollision(), seatAt(), seatLabelOnRoute() (+2 more)

### Community 107 - "unweaveAndClearContainers"
Cohesion: 0.22
Nodes (10): bestUnweaveRoute(), createUnweaveContext(), fanTanglesOf(), segmentStrikesBand(), unweaveAndClearContainers(), unweaveEdge(), unweaveLabelsSeatable(), unweaveRouteAccepted() (+2 more)

### Community 108 - "Releasing cairn"
Cohesion: 0.20
Nodes (9): Cutting a release, If the workflow didn't run, Local dry-run of the packaging step, Releasing cairn, Security posture (keep it), The npm channel, The one exception: npm, The one rule: the tag is the source of truth (+1 more)

### Community 109 - "WORKING METHODOLOGY"
Cohesion: 0.22
Nodes (9): Change hygiene, Collaborate deliberately, Common failure modes, Core workflow, Design conservatively, Evidence over intuition, Git ownership, Verify with independent signals (+1 more)

### Community 110 - "Architecture"
Cohesion: 0.22
Nodes (9): 1. What cairn is and isn't, 2. The pipeline, stage by stage, 3. The data model, 4. The `views` registry as the extension point, 5. Where each invariant is enforced, 6. Determinism budget, 7. Runtime & distribution, 8. Map of the docs (+1 more)

### Community 111 - "Ad"
Cohesion: 0.22
Nodes (9): $5(), Ad(), d1n(), e0n(), u$e(), v2n(), wan(), ywn() (+1 more)

### Community 112 - "R1"
Cohesion: 0.22
Nodes (9): $5n(), ayn(), d7n(), e4(), mN(), mqe(), R1(), w9e() (+1 more)

### Community 113 - "Dc"
Cohesion: 0.22
Nodes (9): Dc(), hLn(), hu(), Hz(), nTn(), o3n(), u3n(), wh() (+1 more)

### Community 114 - "Ub"
Cohesion: 0.28
Nodes (9): eB(), N1(), oge(), pF(), pge(), tQ(), Ub(), wF() (+1 more)

### Community 115 - "Preview"
Cohesion: 0.22
Nodes (9): Application view diagram examples from small to large, Custom colours, Dispositions, Infrastructure view diagram examples from small to large, Logicial view diagram examples from small to large, Matrix flow export example (for the small diagram above), Numbered flows, Preview (+1 more)

### Community 116 - "trySwapSeats"
Cohesion: 0.33
Nodes (9): buildSwap(), crossingsOf(), matchSharedSide(), seatWithAlong(), swapAddsCrossings(), swapCrossingSiblingSeats(), swapSeatsCollide(), trySwapSeats() (+1 more)

### Community 117 - "Testing cairn"
Cohesion: 0.22
Nodes (9): Adding a fixture, Testing cairn, The baseline understands trades, The digest is split three ways, The readability gate, What isn't covered here, When a gate fails, Why there are four layers and not one (+1 more)

### Community 118 - "$1"
Cohesion: 0.25
Nodes (8): $1(), bwn(), dFe(), fQ(), gF(), j4n(), lQ(), wW()

### Community 119 - "xd"
Cohesion: 0.25
Nodes (8): a0n(), Bt(), hke(), iY(), q0n(), wY(), xd(), yE()

### Community 120 - "y3"
Cohesion: 0.29
Nodes (8): aOn(), bpe(), Jm(), jOe(), NE(), OE(), upe(), y3()

### Community 121 - "Wk"
Cohesion: 0.25
Nodes (8): b4n(), gRe(), kje(), tF(), tN(), v8n(), Wk(), zkn()

### Community 122 - "Ea"
Cohesion: 0.25
Nodes (8): B6(), cje(), Ea(), pAe(), qm(), rl(), Uz(), vAe()

### Community 123 - "Xi"
Cohesion: 0.32
Nodes (8): b7n(), cAe(), g$e(), hwn(), oj(), ppe(), xEe(), Xi()

### Community 124 - "n4"
Cohesion: 0.36
Nodes (8): dze(), eze(), fxe(), h2(), jEe(), lSn(), n4(), tSn()

### Community 125 - "pc"
Cohesion: 0.25
Nodes (8): eHe(), fIe(), Gm(), pc(), rt(), v$e(), xW(), z6n()

### Community 126 - "x1"
Cohesion: 0.32
Nodes (8): i2n(), l7n(), oDe(), qj(), uQ(), x1(), Xg(), y6n()

### Community 127 - "package.json"
Cohesion: 0.25
Nodes (7): description, engines, node, name, private, type, version

### Community 128 - "Contributing to cairn"
Cohesion: 0.29
Nodes (7): Commands — when to run what, Contributing to cairn, Getting started, Opening a PR, What you can't break, When a gate fails, Why no build step works for cairn

### Community 129 - "keywords"
Cohesion: 0.29
Nodes (7): keywords, architecture, cli, diagram, diagram-as-code, enterprise-architecture, svg

### Community 130 - "x2"
Cohesion: 0.33
Nodes (7): a4n(), c$e(), kE(), rgn(), vwn(), x2(), xFe()

### Community 131 - "$ge"
Cohesion: 0.29
Nodes (7): aj(), bj(), cj(), dj(), $ge(), n9n(), sFe()

### Community 132 - "zje"
Cohesion: 0.29
Nodes (7): aRe(), awn(), jqe(), lEn(), nSn(), oyn(), zje()

### Community 133 - "nEe"
Cohesion: 0.29
Nodes (7): cSn(), La(), nEe(), npe(), pj(), Up(), yme()

### Community 134 - "dNn"
Cohesion: 0.29
Nodes (7): dNn(), F6(), h9n(), mW(), n5(), vM(), wEn()

### Community 135 - "trySwapSeats"
Cohesion: 0.29
Nodes (7): buildSwap(), matchSharedSide(), swapAddsCrossings(), swapCrossingSiblingSeats(), swapSeatsCollide(), trySwapSeats(), wouldHug()

### Community 136 - "vercel.json"
Cohesion: 0.29
Nodes (6): maxDuration, cleanUrls, functions, api/svg.mjs, headers, $schema

### Community 137 - "render-packaging.mjs"
Cohesion: 0.29
Nodes (5): manifest, rbLines, rbOut, root, sums

### Community 138 - "Flow routing implementation reference"
Cohesion: 0.33
Nodes (6): Architecture of `route-detour.ts`, `edge-tidy.ts` — the two rules that apply to *every* edge, Flow routing implementation reference, Known remaining work, The transpose trick — implementation notes, Verifying a routing change holds everywhere

### Community 139 - "Playground bundles"
Cohesion: 0.33
Nodes (6): Build, Local preview, No Node globals in engine code, Playground bundles, Update playground after modifying `src/`, Why these bundles are committed and the npm ones are not

### Community 140 - "files"
Cohesion: 0.33
Nodes (6): files, bin/cairn.mjs, dist/cairn.mjs, LICENSE, licenses/, THIRD-PARTY-NOTICES.md

### Community 141 - "qze"
Cohesion: 0.53
Nodes (6): a5(), mSn(), pmn(), qze(), Xh(), ySn()

### Community 142 - "p9n"
Cohesion: 0.33
Nodes (6): Bm(), c4n(), p4n(), p9n(), vHe(), y3n()

### Community 143 - "ka"
Cohesion: 0.33
Nodes (6): bTe(), ka(), lyn(), pNe(), qW(), sxn()

### Community 144 - "Qc"
Cohesion: 0.33
Nodes (6): c3n(), Qc(), tEe(), u0n(), w7n(), zRe()

### Community 145 - "eR"
Cohesion: 0.47
Nodes (6): dan(), eR(), gBe(), gSn(), pjn(), sV()

### Community 146 - "zBe"
Cohesion: 0.33
Nodes (6): dSe(), fY(), hV(), jV(), vCe(), zBe()

### Community 147 - "zb"
Cohesion: 0.40
Nodes (6): egn(), f$e(), K6(), lvn(), nLe(), zb()

### Community 148 - "fj"
Cohesion: 0.33
Nodes (6): fj(), mV(), Rh(), s8n(), xV(), zh()

### Community 149 - "wUe"
Cohesion: 0.33
Nodes (6): oTn(), TE(), u8n(), Vg(), Wg(), wUe()

### Community 150 - "cairn playground"
Cohesion: 0.33
Nodes (5): Build the bundles, cairn playground, Deploy to Vercel, Run locally, The /api/svg endpoint

### Community 151 - "cairn.js"
Cohesion: 0.40
Nodes (4): cli, major, minor, r

### Community 152 - "Debug Issue"
Cohesion: 0.40
Nodes (4): Debug Issue, Steps, Tips, Token Efficiency Rules

### Community 153 - "Explore Codebase"
Cohesion: 0.40
Nodes (4): Explore Codebase, Steps, Tips, Token Efficiency Rules

### Community 154 - "Refactor Safely"
Cohesion: 0.40
Nodes (4): Refactor Safely, Safety Checks, Steps, Token Efficiency Rules

### Community 155 - "Review Changes"
Cohesion: 0.40
Nodes (4): Output Format, Review Changes, Steps, Token Efficiency Rules

### Community 156 - "How flow routing works"
Cohesion: 0.40
Nodes (5): How flow routing works, One implementation, both page orientations, The fix: route through a channel, The problem, What "correct" means here

### Community 157 - "bench-elkjs.js"
Cohesion: 0.50
Nodes (4): bench(), ELK, makeGraph(), elkjs

### Community 158 - "p$e"
Cohesion: 0.50
Nodes (5): aNe(), jvn(), m7(), mgn(), p$e()

### Community 159 - "Nf"
Cohesion: 0.40
Nodes (5): c0(), Nf(), $pe(), pUe(), xan()

### Community 160 - "c7n"
Cohesion: 0.40
Nodes (5): c7n(), cxn(), f7n(), gQ(), j6n()

### Community 161 - "ydn"
Cohesion: 0.50
Nodes (5): chn(), j$(), rhn(), ydn(), zdn()

### Community 162 - "t3"
Cohesion: 0.40
Nodes (5): e6n(), gdn(), p8(), s6n(), t3()

### Community 163 - "ur"
Cohesion: 0.40
Nodes (5): eTn(), mBe(), tvn(), ur(), yUe()

### Community 164 - "x8n"
Cohesion: 0.40
Nodes (5): fvn(), oEn(), qLe(), svn(), x8n()

### Community 165 - "shiftAttachment"
Cohesion: 0.40
Nodes (5): farEndCanFollow(), shiftAttachment(), spreadSide(), spreadTargetClear(), wantedAlongs()

### Community 166 - "d2-baseline.mjs"
Cohesion: 0.50
Nodes (3): d2, src, t0

### Community 168 - "aBe"
Cohesion: 0.50
Nodes (4): aBe(), E1(), iK(), uOe()

### Community 169 - "b$e"
Cohesion: 0.67
Nodes (4): b$e(), e7(), kgn(), rvn()

### Community 170 - "vpn"
Cohesion: 0.67
Nodes (4): eUe(), lFe(), o7(), vpn()

### Community 171 - "Y6"
Cohesion: 0.50
Nodes (4): gNe(), ugn(), wFe(), Y6()

### Community 172 - "r8"
Cohesion: 0.50
Nodes (4): gye(), j0n(), m0n(), r8()

### Community 173 - "nTe"
Cohesion: 0.50
Nodes (4): iFe(), nFe(), nTe(), rFe()

### Community 174 - "render-examples.mjs"
Cohesion: 0.50
Nodes (3): dirs, flowFiles, root

### Community 176 - "Bd"
Cohesion: 0.67
Nodes (3): adn(), Bd(), g3n()

### Community 177 - "aIe"
Cohesion: 0.67
Nodes (3): aIe(), gpe(), k2()

### Community 178 - "nV"
Cohesion: 0.67
Nodes (3): bc(), nV(), oi()

### Community 179 - "cNe"
Cohesion: 0.67
Nodes (3): bgn(), cNe(), qFe()

### Community 180 - "uFe"
Cohesion: 0.67
Nodes (3): Bp(), r5(), uFe()

### Community 181 - "rze"
Cohesion: 0.67
Nodes (3): dEe(), qN(), rze()

### Community 182 - "sr"
Cohesion: 0.67
Nodes (3): dke(), Od(), sr()

### Community 183 - "oFe"
Cohesion: 0.67
Nodes (3): eDe(), fyn(), oFe()

### Community 184 - "epn"
Cohesion: 0.67
Nodes (3): epn(), hFe(), t2()

### Community 185 - "eRn"
Cohesion: 0.67
Nodes (3): eRn(), kRn(), xRn()

### Community 186 - "gpn"
Cohesion: 0.67
Nodes (3): gDe(), gpn(), x7n()

### Community 187 - "gFe"
Cohesion: 0.67
Nodes (3): gFe(), rNe(), sgn()

### Community 188 - "gTn"
Cohesion: 0.67
Nodes (3): gTn(), mEn(), u9n()

### Community 189 - "jgn"
Cohesion: 0.67
Nodes (3): jgn(), kFe(), mFe()

### Community 190 - "tM"
Cohesion: 0.67
Nodes (3): LE(), tM(), vgn()

### Community 191 - "rqe"
Cohesion: 0.67
Nodes (3): mK(), rqe(), van()

## Knowledge Gaps
- **486 isolated node(s):** `uvx`, `$schema`, `correctness`, `suspicious`, `pedantic` (+481 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **41 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `"node_modules/elkjs/lib/elk.bundled.js"()` connect `"node_modules/elkjs/lib/elk.bundled.js"` to `Ob`, `xn`, `Xb`, `O`, `engine.node.mjs`, `Hi`, `Gc`, `Ug`, `uo`, `Pd`, `gn`, `i$n`, `Nt`, `lxe`, `Nd`, `mc`, `et`, `Kc`, `lo`, `Po`, `Ei`, `ao`, `Ot`, `D`, `cu`, `v3`, `lj`, `ie`, `bxe`, `Dr`, `xIe`, `kd`, `Wi`, `ah`, `wr`, `Yu`, `bs`, `Xu`, `so`, `hr`, `Gh`, `Vu`, `w3`, `Xr`, `jN`, `Ar`, `Yr`, `lc`, `sidehug.test.ts`, `fOn`, `qA`, `$1`, `Ea`, `Xi`, `n4`, `pc`, `x1`, `x2`, `$ge`, `nEe`, `dNn`, `qze`, `ka`, `Qc`, `eR`, `zBe`, `zb`, `fj`, `ur`, `aBe`, `vpn`, `Y6`, `r8`, `nTe`, `aIe`, `cNe`, `uFe`, `rze`, `oFe`, `epn`, `gFe`, `jgn`, `bFe`, `txe`, `cBe`, `cX`, `wDe`, `gj`, `h2n`, `jBe`, `lK`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `foldedLayout()` connect `slide-fold.ts` to `x2`, `Su`, `cu`, `svg-render.ts`, `scene-layout.ts`, `x1`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `at()` connect `xn` to `cairn-engine.js`, `Ob`, `$ge`, `Xb`, `Hi`, `Gc`, `Ug`, `uo`, `zb`, `gn`, `layout`, `Nt`, `lxe`, `mc`, `sweep.ts`, `lo`, `Po`, `Ei`, `b$e`, `Ot`, `edge`, `nV`, `straightenAndCollapseEdge`, `ah`, `ln`, `straightenAndCollapseEdge`, `Ad`, `$1`, `pc`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 355 inferred relationships involving `"node_modules/elkjs/lib/elk.bundled.js"()` (e.g. with `a1()` and `a3()`) actually correct?**
  _`"node_modules/elkjs/lib/elk.bundled.js"()` has 355 INFERRED edges - model-reasoned connections that need verification._
- **What connects `uvx`, `$schema`, `correctness` to the rest of the system?**
  _486 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `cairn-engine.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0033500837520938024 - nodes in this community are weakly interconnected._
- **Should `Ob` be split into smaller, more focused modules?**
  _Cohesion score 0.04569055036344756 - nodes in this community are weakly interconnected._
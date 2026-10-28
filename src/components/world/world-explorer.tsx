"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import {
  CHUNK_SIZE,
  WORLD_HEIGHT,
  WORLD_SLOT_COUNT,
  WORLD_WIDTH,
} from "@/domain/constants";
import { fromSlotNumber, toSlotNumber } from "@/domain/coordinates";
import {
  ownerEmaSchema,
  randomEmaResponseSchema,
  type ChunkResponse,
  type PublicEma,
  type WorldResponse,
} from "@/domain/schemas";

import {
  assertStableAuthContextEpoch,
  captureStableAuthContextEpoch,
} from "../ema/auth-bound-operation";
import { withAnonymousSessionLock } from "../ema/anonymous-session-coordinator";
import { readAuthContextSnapshot } from "../ema/auth-context-events";
import {
  MAP_FETCH_DEBOUNCE_MS,
  MAX_CONCURRENT_CHUNK_REQUESTS,
  cameraForCoordinate,
  cameraForWholeWorld,
  cameraSearchParams,
  chooseInitialOverviewCamera,
  clampCamera,
  densityForCellPx,
  isTapDistance,
  parseLocationCamera,
  parseStoredCamera,
  pruneMapCache,
  publicMapSchemas,
  serializeCamera,
  visibleChunks,
  worldPointFromCanvas,
  zoomCameraAt,
  chunkKey,
  type Camera,
  type CanvasPoint,
  type ChunkCoordinate,
  type OverviewResponse,
  type Viewport,
} from "./map-contracts";
import { drawWorldMap } from "./map-renderer";
import { PublicEmaFeed } from "./public-ema-feed";

type PublicLoadState = "loading" | "ready" | "error";
type Selection = { x: number; y: number; knownEma?: PublicEma };
type SelectionInfo =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "occupied" }
  | { kind: "public"; ema: PublicEma };

type Gesture = {
  startPoint: CanvasPoint;
  startCamera: Camera;
  hadPinch: boolean;
};

type PinchGesture = {
  pointerIds: readonly [number, number];
  startDistance: number;
  startCellPx: number;
  worldAnchor: { x: number; y: number };
};

const DEFAULT_CAMERA: Camera = {
  centerX: WORLD_WIDTH / 2,
  centerY: WORLD_HEIGHT / 2,
  cellPx: 64,
};
const EMPTY_VIEWPORT: Viewport = { width: 0, height: 0 };
const MAX_CHUNK_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const PUBLIC_MAP_REFRESH_MS = 30_000;

export function WorldExplorer({ worldSlug }: { worldSlug: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapPanelRef = useRef<HTMLElement>(null);
  const cameraRef = useRef<Camera>(DEFAULT_CAMERA);
  const viewportRef = useRef<Viewport>(EMPTY_VIEWPORT);
  const chunksRef = useRef<Map<string, ChunkResponse>>(new Map());
  const chunkLoadedAtRef = useRef<Map<string, number>>(new Map());
  const overviewRef = useRef<OverviewResponse | null>(null);
  const overviewCacheRef = useRef<Map<20 | 100, OverviewResponse>>(new Map());
  const selectionRef = useRef<Selection | null>(null);
  const drawFrameRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const chooseInitialAreaRef = useRef(false);
  const initialAreaChosenRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const pointersRef = useRef<Map<number, CanvasPoint>>(new Map());
  const gestureRef = useRef<Gesture | null>(null);
  const pinchRef = useRef<PinchGesture | null>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [viewport, setViewport] = useState<Viewport>(EMPTY_VIEWPORT);
  const [settledCamera, setSettledCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [cameraHud, setCameraHud] = useState<Camera>(DEFAULT_CAMERA);
  const [selection, setSelectionState] = useState<Selection | null>(null);
  const [chunkSnapshot, setChunkSnapshot] = useState<
    ReadonlyMap<string, ChunkResponse>
  >(() => new Map());
  const [worldState, setWorldState] = useState<PublicLoadState>("loading");
  const [worldResponse, setWorldResponse] = useState<WorldResponse | null>(
    null,
  );
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const [slotInput, setSlotInput] = useState("");
  const [slotError, setSlotError] = useState<string | null>(null);
  const [randomPending, setRandomPending] = useState(false);
  const [ownerPending, setOwnerPending] = useState(false);
  const [dataRetry, setDataRetry] = useState(0);
  const [pageVisible, setPageVisible] = useState(false);

  const cameraStorageKey = `emanowa:map-camera:v1:${worldSlug}`;

  const requestDraw = useCallback(() => {
    if (drawFrameRef.current !== null) return;
    drawFrameRef.current = requestAnimationFrame(() => {
      drawFrameRef.current = null;
      if (document.visibilityState === "hidden") return;
      const canvas = canvasRef.current;
      const currentViewport = viewportRef.current;
      if (
        !canvas ||
        currentViewport.width <= 0 ||
        currentViewport.height <= 0
      ) {
        return;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const requestedChunks = visibleChunks(cameraRef.current, currentViewport);
      const density =
        requestedChunks === null
          ? "overview-20"
          : densityForCellPx(cameraRef.current.cellPx);
      drawWorldMap({
        context,
        viewport: currentViewport,
        camera: cameraRef.current,
        density,
        overview: overviewRef.current,
        visibleChunkCoordinates: requestedChunks,
        chunks: chunksRef.current,
        selection: selectionRef.current,
      });
    });
  }, []);

  const persistCamera = useCallback(
    (camera: Camera): void => {
      try {
        sessionStorage.setItem(cameraStorageKey, serializeCamera(camera));
      } catch {
        // The map remains usable when storage is unavailable.
      }
    },
    [cameraStorageKey],
  );

  const replaceLocation = useCallback((camera: Camera): void => {
    const query = cameraSearchParams(window.location.search, camera);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${query}${window.location.hash}`,
    );
  }, []);

  const commitCamera = useCallback(
    (
      nextCamera: Camera,
      options: { updateLocation?: boolean } = { updateLocation: true },
    ): void => {
      const currentViewport = viewportRef.current;
      const next =
        currentViewport.width > 0 && currentViewport.height > 0
          ? clampCamera(nextCamera, currentViewport)
          : nextCamera;
      cameraRef.current = next;
      setCameraHud(next);
      setSettledCamera(next);
      persistCamera(next);
      if (options.updateLocation !== false) replaceLocation(next);
      requestDraw();
    },
    [persistCamera, replaceLocation, requestDraw],
  );

  const setSelection = useCallback(
    (next: Selection | null): void => {
      selectionRef.current = next;
      setSelectionState(next);
      requestDraw();
    },
    [requestDraw],
  );

  const invalidateSelectedPublicEma = useCallback((): void => {
    const current = selectionRef.current;
    if (!current?.knownEma) return;
    const coordinateOnly = { x: current.x, y: current.y };
    selectionRef.current = coordinateOnly;
    setSelectionState(coordinateOnly);
  }, []);

  const saveBeforeNavigation = useCallback(() => {
    persistCamera(cameraRef.current);
  }, [persistCamera]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const locationCamera = parseLocationCamera(window.location.search);
      let storedCamera: Camera | null = null;
      try {
        storedCamera = parseStoredCamera(
          sessionStorage.getItem(cameraStorageKey),
        );
      } catch {
        storedCamera = null;
      }
      const initial = locationCamera ?? storedCamera ?? DEFAULT_CAMERA;
      chooseInitialAreaRef.current =
        locationCamera === null && storedCamera === null;
      initializedRef.current = true;
      cameraRef.current = initial;
      setCameraHud(initial);
      setSettledCamera(initial);
      requestDraw();
    });
    return () => cancelAnimationFrame(frame);
  }, [cameraStorageKey, requestDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(320, Math.round(entry.contentRect.height));
      const nextViewport = { width, height };
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      viewportRef.current = nextViewport;
      setViewport(nextViewport);
      const nextCamera = clampCamera(cameraRef.current, nextViewport);
      cameraRef.current = nextCamera;
      setCameraHud(nextCamera);
      setSettledCamera(nextCamera);
      requestDraw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [requestDraw]);

  useEffect(() => {
    if (!pageVisible) return;
    const controller = new AbortController();
    void fetch(`/api/v1/worlds/${encodeURIComponent(worldSlug)}`, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) throw new Error("世界の情報を読み込めませんでした。");
        const parsed = publicMapSchemas.world.safeParse(body);
        if (!parsed.success || parsed.data.world.slug !== worldSlug) {
          throw new Error("世界の応答を確認できませんでした。");
        }
        setWorldResponse(parsed.data);
        setWorldState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setWorldState("error");
          setMapMessage(
            error instanceof Error
              ? error.message
              : "世界の情報を読み込めませんでした。",
          );
        }
      });
    return () => controller.abort();
  }, [dataRetry, pageVisible, worldSlug]);

  useEffect(() => {
    if (!pageVisible) return;
    const controller = new AbortController();
    void fetchOverview(worldSlug, 100, controller.signal)
      .then((response) => {
        overviewCacheRef.current.set(100, response);
        if (densityForCellPx(cameraRef.current.cellPx) === "overview-100") {
          overviewRef.current = response;
        }
        if (
          chooseInitialAreaRef.current &&
          !initialAreaChosenRef.current &&
          initializedRef.current
        ) {
          initialAreaChosenRef.current = true;
          const candidate = chooseInitialOverviewCamera(response);
          if (candidate) {
            commitCamera(candidate, { updateLocation: false });
          }
        }
        requestDraw();
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMapError("全体概要を読み込めませんでした。");
        }
      });
    return () => controller.abort();
  }, [commitCamera, dataRetry, pageVisible, requestDraw, worldSlug]);

  useEffect(() => {
    if (
      !pageVisible ||
      !initializedRef.current ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      return;
    }
    requestGenerationRef.current += 1;
    const generation = requestGenerationRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const requestedChunks = visibleChunks(settledCamera, viewport);
      const density = densityForCellPx(settledCamera.cellPx);
      setMapLoading(true);
      setMapError(null);
      if (density !== "individual" || requestedChunks === null) {
        const cellSize: 20 | 100 = density === "overview-100" ? 100 : 20;
        const cached = overviewCacheRef.current.get(cellSize);
        if (cached) {
          overviewRef.current = cached;
          setMapLoading(false);
          requestDraw();
          return;
        }
        void fetchOverview(worldSlug, cellSize, controller.signal)
          .then((response) => {
            if (requestGenerationRef.current !== generation) return;
            overviewCacheRef.current.set(cellSize, response);
            overviewRef.current = response;
            setMapLoading(false);
            requestDraw();
          })
          .catch((error: unknown) => {
            if (
              requestGenerationRef.current === generation &&
              !(error instanceof DOMException && error.name === "AbortError")
            ) {
              setMapLoading(false);
              setMapError("地図の集計を読み込めませんでした。");
              requestDraw();
            }
          });
        return;
      }

      const protectedKeys = new Set(requestedChunks.map(chunkKey));
      let removedStale = false;
      const missing = requestedChunks.filter((chunk) => {
        const key = chunkKey(chunk);
        const loadedAt = chunkLoadedAtRef.current.get(key);
        const stale =
          !chunksRef.current.has(key) ||
          loadedAt === undefined ||
          Date.now() - loadedAt >= PUBLIC_MAP_REFRESH_MS;
        if (stale && chunksRef.current.delete(key)) {
          chunkLoadedAtRef.current.delete(key);
          removedStale = true;
        }
        return stale;
      });
      if (removedStale) {
        setChunkSnapshot(new Map(chunksRef.current));
        requestDraw();
      }
      if (missing.length === 0) {
        setMapLoading(false);
        requestDraw();
        return;
      }
      void fetchChunkPool(
        worldSlug,
        missing,
        controller.signal,
        async (response) => {
          if (requestGenerationRef.current !== generation) return;
          const key = chunkKey({ cx: response.cx, cy: response.cy });
          chunksRef.current.delete(key);
          chunksRef.current.set(key, response);
          chunkLoadedAtRef.current.set(key, Date.now());
          for (const removedKey of pruneMapCache(
            chunksRef.current,
            protectedKeys,
          )) {
            chunkLoadedAtRef.current.delete(removedKey);
          }
        },
      )
        .then(() => {
          if (requestGenerationRef.current !== generation) return;
          setChunkSnapshot(new Map(chunksRef.current));
          setMapLoading(false);
          requestDraw();
        })
        .catch((error: unknown) => {
          if (
            requestGenerationRef.current === generation &&
            !(error instanceof DOMException && error.name === "AbortError")
          ) {
            setMapLoading(false);
            setMapError(
              "この範囲の地図を読み込めませんでした。未取得の場所は空きとして扱いません。",
            );
            requestDraw();
          }
        });
    }, MAP_FETCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [dataRetry, pageVisible, requestDraw, settledCamera, viewport, worldSlug]);

  useEffect(() => {
    const handleVisibility = (): void => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      requestGenerationRef.current += 1;
      if (visible) {
        chunksRef.current.clear();
        chunkLoadedAtRef.current.clear();
        overviewCacheRef.current.clear();
        overviewRef.current = null;
        invalidateSelectedPublicEma();
        setChunkSnapshot(new Map(chunksRef.current));
        setWorldState("loading");
        requestDraw();
        setDataRetry((current) => current + 1);
      }
    };
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [invalidateSelectedPublicEma, requestDraw]);

  useEffect(() => {
    if (!pageVisible) return;
    const timer = window.setInterval(() => {
      chunksRef.current.clear();
      chunkLoadedAtRef.current.clear();
      overviewCacheRef.current.clear();
      overviewRef.current = null;
      invalidateSelectedPublicEma();
      setChunkSnapshot(new Map());
      requestDraw();
      setDataRetry((current) => current + 1);
    }, PUBLIC_MAP_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [invalidateSelectedPublicEma, pageVisible, requestDraw]);

  useEffect(
    () => () => {
      if (drawFrameRef.current !== null)
        cancelAnimationFrame(drawFrameRef.current);
      if (wheelTimerRef.current !== null) clearTimeout(wheelTimerRef.current);
      requestGenerationRef.current += 1;
    },
    [],
  );

  const selectionInfo = resolveSelection(selection, chunkSnapshot);
  const acceptingPosts = worldResponse?.world.acceptingPosts ?? false;
  const isFull =
    worldResponse?.stats.occupiedCount === WORLD_SLOT_COUNT || false;
  const requestedChunks =
    viewport.width > 0 ? visibleChunks(cameraHud, viewport) : [];
  const effectiveDensity =
    requestedChunks === null
      ? "overview-20"
      : densityForCellPx(cameraHud.cellPx);

  const focusCoordinate = useCallback(
    (x: number, y: number, knownEma?: PublicEma): void => {
      const next = cameraForCoordinate(x, y, 80);
      commitCamera(next);
      setSelection({ x, y, knownEma });
      setMapMessage(
        knownEma
          ? `場所 ${knownEma.slotNumber.toLocaleString("ja-JP")}番へ移動しました。`
          : `場所 ${toSlotNumber(x, y).toLocaleString("ja-JP")}番へ移動しました。`,
      );
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      mapPanelRef.current?.scrollIntoView({
        block: "start",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    },
    [commitCamera, setSelection],
  );

  const openPublicEma = useCallback(
    (ema: PublicEma): void => {
      saveBeforeNavigation();
      router.push(
        `/w/${encodeURIComponent(worldSlug)}/e/${encodeURIComponent(ema.publicId)}`,
      );
    },
    [router, saveBeforeNavigation, worldSlug],
  );

  const activateSelection = useCallback(
    (info: SelectionInfo): void => {
      if (!selectionRef.current) return;
      if (info.kind === "public") {
        openPublicEma(info.ema);
        return;
      }
      if (info.kind === "occupied") {
        setMapMessage("この場所には絵馬が掛かっています。");
        return;
      }
      if (info.kind === "loading") {
        setMapMessage(
          "この場所はまだ確認中です。読み込みが終わってから操作してください。",
        );
        return;
      }
      if (!acceptingPosts || isFull) {
        setMapMessage(
          isFull
            ? "この年の場所は満員です。公開絵馬を眺めることはできます。"
            : "この年は現在、絵馬を受け付けていません。",
        );
        return;
      }
      const selected = selectionRef.current;
      saveBeforeNavigation();
      router.push(
        `/w/${encodeURIComponent(worldSlug)}/new?x=${String(selected.x)}&y=${String(selected.y)}`,
      );
    },
    [
      acceptingPosts,
      isFull,
      openPublicEma,
      router,
      saveBeforeNavigation,
      worldSlug,
    ],
  );

  const handleMapTap = useCallback(
    (point: CanvasPoint): void => {
      const currentViewport = viewportRef.current;
      const camera = cameraRef.current;
      const world = worldPointFromCanvas(point, camera, currentViewport);
      const x = Math.floor(world.x);
      const y = Math.floor(world.y);
      if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) {
        setMapMessage("地図の外側は選べません。");
        return;
      }
      const chunks = visibleChunks(camera, currentViewport);
      if (densityForCellPx(camera.cellPx) !== "individual" || chunks === null) {
        commitCamera(cameraForCoordinate(x, y, 64));
        setSelection(null);
        setMapMessage("選んだ付近を拡大しました。");
        return;
      }
      const nextSelection = { x, y };
      const info = resolveSelection(nextSelection, chunksRef.current);
      if (info.kind === "public") {
        setSelection({ ...nextSelection, knownEma: info.ema });
        openPublicEma(info.ema);
        return;
      }
      setSelection(nextSelection);
      setMapMessage(selectionMessage(info, toSlotNumber(x, y)));
    },
    [commitCamera, openPublicEma, setSelection],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size === 1) {
      gestureRef.current = {
        startPoint: point,
        startCamera: cameraRef.current,
        hadPinch: false,
      };
      pinchRef.current = null;
    } else if (pointersRef.current.size === 2) {
      const entries = [...pointersRef.current.entries()] as [
        [number, CanvasPoint],
        [number, CanvasPoint],
      ];
      const midpoint = midpointOf(entries[0][1], entries[1][1]);
      pinchRef.current = {
        pointerIds: [entries[0][0], entries[1][0]],
        startDistance: Math.max(1, distance(entries[0][1], entries[1][1])),
        startCellPx: cameraRef.current.cellPx,
        worldAnchor: worldPointFromCanvas(
          midpoint,
          cameraRef.current,
          viewportRef.current,
        ),
      };
      if (gestureRef.current) gestureRef.current.hadPinch = true;
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const point = localPoint(event);
    pointersRef.current.set(event.pointerId, point);
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const first = pointersRef.current.get(pinch.pointerIds[0]);
      const second = pointersRef.current.get(pinch.pointerIds[1]);
      if (first && second) {
        const midpoint = midpointOf(first, second);
        const nextCellPx =
          pinch.startCellPx * (distance(first, second) / pinch.startDistance);
        const temporary = zoomCameraAt(
          cameraRef.current,
          viewportRef.current,
          midpoint,
          nextCellPx,
        );
        const cellPx = temporary.cellPx;
        cameraRef.current = clampCamera(
          {
            centerX:
              pinch.worldAnchor.x -
              (midpoint.x - viewportRef.current.width / 2) / cellPx,
            centerY:
              pinch.worldAnchor.y -
              (midpoint.y - viewportRef.current.height / 2) / cellPx,
            cellPx,
          },
          viewportRef.current,
        );
        requestDraw();
      }
      return;
    }

    const gesture = gestureRef.current;
    if (!gesture || pointersRef.current.size !== 1) return;
    if (isTapDistance(gesture.startPoint, point)) return;
    cameraRef.current = clampCamera(
      {
        centerX:
          gesture.startCamera.centerX -
          (point.x - gesture.startPoint.x) / gesture.startCamera.cellPx,
        centerY:
          gesture.startCamera.centerY -
          (point.y - gesture.startPoint.y) / gesture.startCamera.cellPx,
        cellPx: gesture.startCamera.cellPx,
      },
      viewportRef.current,
    );
    requestDraw();
  };

  const finishPointer = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    cancelled: boolean,
  ): void => {
    const upPoint = localPoint(event);
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, upPoint);
    }
    const previousPoint = pointersRef.current.get(event.pointerId);
    const gesture = gestureRef.current;
    const wasSinglePointer = pointersRef.current.size === 1;
    const wasTap =
      !cancelled &&
      wasSinglePointer &&
      previousPoint !== undefined &&
      gesture !== null &&
      !gesture.hadPinch &&
      isTapDistance(gesture.startPoint, previousPoint);
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (pointersRef.current.size === 1) {
      const remaining = [...pointersRef.current.values()][0]!;
      gestureRef.current = {
        startPoint: remaining,
        startCamera: cameraRef.current,
        hadPinch: true,
      };
      pinchRef.current = null;
      return;
    }
    if (pointersRef.current.size > 1) return;

    pinchRef.current = null;
    gestureRef.current = null;
    commitCamera(cameraRef.current);
    if (wasTap && previousPoint) handleMapTap(previousPoint);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    cameraRef.current = zoomCameraAt(
      cameraRef.current,
      viewportRef.current,
      localPoint(event),
      cameraRef.current.cellPx * factor,
    );
    requestDraw();
    if (wheelTimerRef.current !== null) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      wheelTimerRef.current = null;
      commitCamera(cameraRef.current);
    }, 150);
  };

  const zoomBy = (factor: number): void => {
    const currentViewport = viewportRef.current;
    commitCamera(
      zoomCameraAt(
        cameraRef.current,
        currentViewport,
        { x: currentViewport.width / 2, y: currentViewport.height / 2 },
        cameraRef.current.cellPx * factor,
      ),
    );
  };

  const handleMapKeyDown = (
    event: ReactKeyboardEvent<HTMLCanvasElement>,
  ): void => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1.5);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomBy(1 / 1.5);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelection(null);
      setMapMessage("選択を解除しました。");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activateSelection(
        resolveSelection(selectionRef.current, chunksRef.current),
      );
      return;
    }
    const direction =
      event.key === "ArrowLeft"
        ? { dx: -1, dy: 0 }
        : event.key === "ArrowRight"
          ? { dx: 1, dy: 0 }
          : event.key === "ArrowUp"
            ? { dx: 0, dy: -1 }
            : event.key === "ArrowDown"
              ? { dx: 0, dy: 1 }
              : null;
    if (!direction) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const current = selectionRef.current ?? {
      x: clampInt(Math.floor(cameraRef.current.centerX), 0, WORLD_WIDTH - 1),
      y: clampInt(Math.floor(cameraRef.current.centerY), 0, WORLD_HEIGHT - 1),
    };
    const x = clampInt(current.x + direction.dx * amount, 0, WORLD_WIDTH - 1);
    const y = clampInt(current.y + direction.dy * amount, 0, WORLD_HEIGHT - 1);
    commitCamera({
      centerX: x + 0.5,
      centerY: y + 0.5,
      cellPx: cameraRef.current.cellPx,
    });
    setSelection({ x, y });
    setMapMessage(
      `場所 ${toSlotNumber(x, y).toLocaleString("ja-JP")}番を選びました。`,
    );
  };

  const goToSlot = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = Number(slotInput);
    if (!Number.isInteger(parsed)) {
      setSlotError("1〜1,000,000の整数を入力してください。");
      return;
    }
    try {
      const coordinate = fromSlotNumber(parsed);
      setSlotError(null);
      focusCoordinate(coordinate.x, coordinate.y);
    } catch {
      setSlotError("1〜1,000,000の範囲で入力してください。");
    }
  };

  const visitRandom = async (): Promise<void> => {
    if (randomPending) return;
    const controller = new AbortController();
    setRandomPending(true);
    setMapMessage(null);
    try {
      const response = await fetch(
        `/api/v1/worlds/${encodeURIComponent(worldSlug)}/emas/random`,
        {
          cache: "no-store",
          credentials: "omit",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) throw new Error("ランダムな絵馬を探せませんでした。");
      const parsed = randomEmaResponseSchema.safeParse(body);
      if (
        !parsed.success ||
        (parsed.data.item && parsed.data.item.worldSlug !== worldSlug)
      ) {
        throw new Error("ランダム訪問の応答を確認できませんでした。");
      }
      if (!parsed.data.item) {
        setMapMessage("ランダムに訪ねられる公開絵馬はまだありません。");
        return;
      }
      focusCoordinate(parsed.data.item.x, parsed.data.item.y, parsed.data.item);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMapMessage(
          error instanceof Error
            ? error.message
            : "ランダムな絵馬を探せませんでした。",
        );
      }
    } finally {
      setRandomPending(false);
    }
  };

  const goToOwnEma = async (): Promise<void> => {
    if (ownerPending) return;
    setOwnerPending(true);
    setMapMessage("自分の絵馬を確認しています…");
    try {
      const result = await withAnonymousSessionLock(async () => {
        const epoch = captureStableAuthContextEpoch(readAuthContextSnapshot());
        const response = await fetch(
          `/api/v1/me/emas?world=${encodeURIComponent(worldSlug)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          },
        );
        const body = (await response.json().catch(() => null)) as unknown;
        assertStableAuthContextEpoch(epoch, readAuthContextSnapshot());
        return { response, body, epoch };
      });
      assertStableAuthContextEpoch(result.epoch, readAuthContextSnapshot());
      if (!result.response.ok) {
        setMapMessage(
          result.response.status === 401
            ? "このブラウザでは自分の絵馬を確認できません。メールで復元するか、新しく書き始めてください。"
            : "自分の絵馬を確認できませんでした。",
        );
        return;
      }
      const candidate =
        result.body && typeof result.body === "object" && "ema" in result.body
          ? (result.body as { ema: unknown }).ema
          : undefined;
      if (candidate === null) {
        setMapMessage("この年には、まだ自分の絵馬を掛けていません。");
        return;
      }
      const parsed = ownerEmaSchema.safeParse(candidate);
      if (!parsed.success || parsed.data.worldSlug !== worldSlug) {
        setMapMessage("自分の絵馬の応答を確認できませんでした。");
        return;
      }
      focusCoordinate(parsed.data.x, parsed.data.y);
      setMapMessage(
        parsed.data.status === "hidden"
          ? "自分の絵馬の場所へ移動しました。現在は公開されていません。"
          : "自分の絵馬の場所へ移動しました。",
      );
    } catch {
      setMapMessage(
        "本人情報の確認中に状態が変わりました。もう一度お試しください。",
      );
    } finally {
      setOwnerPending(false);
    }
  };

  const copyLocation = async (): Promise<void> => {
    commitCamera(cameraRef.current);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMapMessage("いま見ている場所のURLをコピーしました。");
    } catch {
      setMapMessage(
        "URLをコピーできませんでした。ブラウザのアドレス欄からコピーしてください。",
      );
    }
  };

  const selectedSlot = selection
    ? toSlotNumber(selection.x, selection.y)
    : null;

  return (
    <>
      <div className="action-row world-actions">
        {worldState === "ready" && acceptingPosts && !isFull ? (
          <Link
            className="button"
            href={`/w/${encodeURIComponent(worldSlug)}/new`}
            onClick={saveBeforeNavigation}
          >
            絵馬を書く
          </Link>
        ) : (
          <span className="button" aria-disabled="true">
            {worldState === "loading"
              ? "受付状況を確認中…"
              : isFull
                ? "満員です"
                : worldState === "error"
                  ? "受付状況を確認できません"
                  : "現在は受付していません"}
          </span>
        )}
        <button
          className="button button--secondary"
          type="button"
          onClick={() => void goToOwnEma()}
          disabled={ownerPending}
        >
          {ownerPending ? "確認中…" : "自分の絵馬"}
        </button>
        <a className="button button--quiet" href="#ema-list">
          一覧で見る
        </a>
      </div>

      <div className="world-summary" aria-label="この年の絵馬の状況">
        {worldResponse ? (
          <>
            <p>
              <strong>
                {worldResponse.stats.activeCount.toLocaleString("ja-JP")}
              </strong>
              <span>掛かっている絵馬</span>
            </p>
            <p>
              <strong>
                {worldResponse.stats.listedCount.toLocaleString("ja-JP")}
              </strong>
              <span>一覧で見られる絵馬</span>
            </p>
            <p>
              <strong>
                {(
                  WORLD_SLOT_COUNT - worldResponse.stats.occupiedCount
                ).toLocaleString("ja-JP")}
              </strong>
              <span>空いている場所</span>
            </p>
          </>
        ) : (
          <p className="muted">
            {worldState === "error"
              ? "状況を読み込めませんでした"
              : "状況を確認しています…"}
          </p>
        )}
      </div>

      <div className="world-layout world-layout--explorer">
        <section
          className="world-panel map-panel"
          aria-labelledby="world-map-title"
          ref={mapPanelRef}
        >
          <header className="world-panel__header">
            <div>
              <h2 id="world-map-title">絵馬の地図</h2>
              <p className="fine-print">
                {densityLabel(effectiveDensity, requestedChunks === null)}
              </p>
            </div>
            <span className="map-scale" aria-label="地図の倍率">
              1枠 {formatCellPx(cameraHud.cellPx)}px
            </span>
          </header>

          <div className="map-toolbar" aria-label="地図の操作">
            <div className="map-toolbar__group">
              <button
                type="button"
                onClick={() => zoomBy(1.5)}
                aria-label="拡大"
              >
                ＋
              </button>
              <button
                type="button"
                onClick={() => zoomBy(1 / 1.5)}
                aria-label="縮小"
              >
                −
              </button>
              <button
                type="button"
                onClick={() =>
                  commitCamera(cameraForWholeWorld(viewportRef.current))
                }
              >
                全体を見る
              </button>
              <button
                type="button"
                onClick={() =>
                  commitCamera({
                    centerX: WORLD_WIDTH / 2,
                    centerY: WORLD_HEIGHT / 2,
                    cellPx: cameraRef.current.cellPx,
                  })
                }
              >
                中心へ戻る
              </button>
            </div>
            <div className="map-toolbar__group">
              <button type="button" onClick={() => void copyLocation()}>
                場所URLをコピー
              </button>
              <button
                type="button"
                onClick={() => void visitRandom()}
                disabled={randomPending}
              >
                {randomPending ? "探しています…" : "ランダム"}
              </button>
            </div>
          </div>

          <div className="map-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="world-canvas"
              tabIndex={0}
              role="application"
              aria-label="100万枠の絵馬地図。ドラッグで移動、ピンチまたはプラスとマイナスで拡大縮小できます。"
              aria-describedby="map-keyboard-help map-selection-status"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => finishPointer(event, false)}
              onPointerCancel={(event) => finishPointer(event, true)}
              onWheel={handleWheel}
              onKeyDown={handleMapKeyDown}
            >
              Canvasを利用できない場合は、この下の公開絵馬一覧をご利用ください。
            </canvas>
            {mapLoading ? (
              <p className="map-loading" role="status">
                地図を確認しています…
              </p>
            ) : null}
          </div>

          <p className="map-keyboard-help fine-print" id="map-keyboard-help">
            地図にフォーカスすると、矢印キーで1枠、Shift＋矢印で10枠移動します。＋/−で拡大縮小、Enterで選択、Escapeで解除できます。
          </p>

          {mapError ? (
            <div className="map-error" role="alert">
              <p>{mapError}</p>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setDataRetry((current) => current + 1)}
              >
                もう一度読み込む
              </button>
            </div>
          ) : null}

          <div className="map-selection" id="map-selection-status">
            {selection && selectedSlot ? (
              <>
                <div>
                  <p className="eyebrow">選択中</p>
                  <h3>場所 {selectedSlot.toLocaleString("ja-JP")}番</h3>
                  <p>{selectionDescription(selectionInfo)}</p>
                </div>
                <div className="map-selection__actions">
                  {selectionInfo.kind === "public" ? (
                    <button
                      className="button"
                      type="button"
                      onClick={() => activateSelection(selectionInfo)}
                    >
                      絵馬を読む
                    </button>
                  ) : null}
                  {selectionInfo.kind === "empty" &&
                  acceptingPosts &&
                  !isFull ? (
                    <Link
                      className="button"
                      href={`/w/${encodeURIComponent(worldSlug)}/new?x=${String(selection.x)}&y=${String(selection.y)}`}
                      onClick={saveBeforeNavigation}
                    >
                      ここに掛ける
                    </Link>
                  ) : null}
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => setSelection(null)}
                  >
                    選択を解除
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">
                近景で場所を選ぶと、空き・確認中・使用中をここに表示します。
              </p>
            )}
          </div>

          <form className="slot-jump" onSubmit={goToSlot} noValidate>
            <label htmlFor="slot-number-jump">場所の番号から移動</label>
            <div>
              <input
                id="slot-number-jump"
                name="slotNumber"
                inputMode="numeric"
                pattern="[0-9]*"
                value={slotInput}
                onChange={(event) => setSlotInput(event.target.value)}
                aria-invalid={Boolean(slotError)}
                aria-describedby={
                  slotError ? "slot-number-jump-error" : undefined
                }
                placeholder="例：500501"
              />
              <button className="button button--secondary" type="submit">
                移動する
              </button>
            </div>
            {slotError ? (
              <p className="field__error" id="slot-number-jump-error">
                {slotError}
              </p>
            ) : null}
          </form>

          <p className="map-result" role="status" aria-live="polite">
            {mapMessage}
          </p>
        </section>

        <PublicEmaFeed
          worldSlug={worldSlug}
          onFocus={(ema) => focusCoordinate(ema.x, ema.y, ema)}
          onRandom={() => void visitRandom()}
          randomPending={randomPending}
        />
      </div>
    </>
  );
}

function resolveSelection(
  selection: Selection | null,
  chunks: ReadonlyMap<string, ChunkResponse>,
): SelectionInfo {
  if (!selection) return { kind: "loading" };
  if (selection.knownEma) return { kind: "public", ema: selection.knownEma };
  const key = chunkKey({
    cx: Math.floor(selection.x / CHUNK_SIZE),
    cy: Math.floor(selection.y / CHUNK_SIZE),
  });
  const chunk = chunks.get(key);
  if (!chunk) return { kind: "loading" };
  const cell = chunk.cells.find((candidate) => {
    const coordinate =
      candidate.kind === "public"
        ? { x: candidate.ema.x, y: candidate.ema.y }
        : { x: candidate.x, y: candidate.y };
    return coordinate.x === selection.x && coordinate.y === selection.y;
  });
  if (!cell) return { kind: "empty" };
  return cell.kind === "public"
    ? { kind: "public", ema: cell.ema }
    : { kind: "occupied" };
}

function selectionMessage(info: SelectionInfo, slotNumber: number): string {
  const prefix = `場所 ${slotNumber.toLocaleString("ja-JP")}番。`;
  if (info.kind === "empty") return `${prefix}空いています。`;
  if (info.kind === "occupied") {
    return `${prefix}この場所には絵馬が掛かっています。`;
  }
  if (info.kind === "public") return `${prefix}公開絵馬があります。`;
  return `${prefix}占有状況を確認しています。`;
}

function selectionDescription(info: SelectionInfo): string {
  if (info.kind === "empty")
    return "この場所は空いています。選択中ですが、まだ予約されていません。";
  if (info.kind === "occupied")
    return "この場所には絵馬が掛かっています。公開されていない情報は表示しません。";
  if (info.kind === "public") {
    return info.ema.messageText ?? "ひみつの願い";
  }
  return "占有状況を確認しています。未取得の場所を空きとは扱いません。";
}

function densityLabel(
  density: ReturnType<typeof densityForCellPx>,
  limited: boolean,
): string {
  if (limited) return "描画量を抑えるため、集計表示に切り替えています";
  if (density === "overview-100") return "100×100枠ごとの使用状況";
  if (density === "overview-20") return "20×20枠ごとの使用状況";
  return "公開絵馬と使用中の場所";
}

function formatCellPx(value: number): string {
  return value < 10 ? value.toFixed(2) : value.toFixed(0);
}

function localPoint(
  event:
    ReactPointerEvent<HTMLCanvasElement> | ReactWheelEvent<HTMLCanvasElement>,
): CanvasPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function midpointOf(first: CanvasPoint, second: CanvasPoint): CanvasPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distance(first: CanvasPoint, second: CanvasPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.trunc(Math.min(maximum, Math.max(minimum, value)));
}

async function fetchOverview(
  worldSlug: string,
  cellSize: 20 | 100,
  signal: AbortSignal,
): Promise<OverviewResponse> {
  const response = await fetch(
    `/api/v1/worlds/${encodeURIComponent(worldSlug)}/overview?cellSize=${String(cellSize)}`,
    {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  const body = await readJsonWithLimit(response, MAX_CHUNK_RESPONSE_BYTES);
  if (!response.ok) throw new Error("地図の集計を読み込めませんでした。");
  const parsed = publicMapSchemas.overview.safeParse(body);
  if (!parsed.success || parsed.data.cellSize !== cellSize) {
    throw new Error("地図の集計応答を確認できませんでした。");
  }
  return parsed.data;
}

async function fetchChunkPool(
  worldSlug: string,
  chunks: readonly ChunkCoordinate[],
  signal: AbortSignal,
  onChunk: (response: ChunkResponse) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < chunks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const chunk = chunks[currentIndex];
      if (!chunk) return;
      const response = await fetch(
        `/api/v1/worlds/${encodeURIComponent(worldSlug)}/chunks?cx=${String(chunk.cx)}&cy=${String(chunk.cy)}`,
        {
          cache: "no-store",
          credentials: "omit",
          headers: { Accept: "application/json" },
          signal,
        },
      );
      const body = await readJsonWithLimit(response, MAX_CHUNK_RESPONSE_BYTES);
      if (!response.ok) throw new Error("地図チャンクを読み込めませんでした。");
      const parsed = publicMapSchemas.chunk.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.worldSlug !== worldSlug ||
        parsed.data.cx !== chunk.cx ||
        parsed.data.cy !== chunk.cy
      ) {
        throw new Error("地図チャンクの応答を確認できませんでした。");
      }
      await onChunk(parsed.data);
    }
  };
  const workerCount = Math.min(MAX_CONCURRENT_CHUNK_REQUESTS, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

async function readJsonWithLimit(
  response: Response,
  limitBytes: number,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    throw new Error("地図データが保護上限を超えました。");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > limitBytes) {
    throw new Error("地図データが保護上限を超えました。");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

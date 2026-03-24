figma.showUI(__html__, {
  width: 440,
  height: 720,
  themeColors: true,
});

const FONT_FAMILY_CANDIDATES = ["Pretendard", "Inter"];
const FONT_STYLE_CANDIDATES = {
  100: ["Thin", "ExtraLight", "Light", "Regular"],
  200: ["ExtraLight", "Light", "Regular"],
  300: ["Light", "Regular"],
  400: ["Regular", "Book", "Medium"],
  500: ["Medium", "Regular", "Semi Bold"],
  600: ["Semi Bold", "Bold", "Medium"],
  700: ["Bold", "Semi Bold", "Extra Bold"],
  800: ["Extra Bold", "Bold", "Black"],
  900: ["Black", "Extra Bold", "Bold"],
};

const loadedFonts = new Set();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWeight(weight) {
  const numeric = Number(weight);
  if (!Number.isFinite(numeric)) return 400;
  if (numeric <= 150) return 100;
  if (numeric <= 250) return 200;
  if (numeric <= 350) return 300;
  if (numeric <= 450) return 400;
  if (numeric <= 550) return 500;
  if (numeric <= 650) return 600;
  if (numeric <= 750) return 700;
  if (numeric <= 850) return 800;
  return 900;
}

async function ensureFontLoaded(fontName) {
  const key = `${fontName.family}::${fontName.style}`;
  if (loadedFonts.has(key)) return fontName;
  await figma.loadFontAsync(fontName);
  loadedFonts.add(key);
  return fontName;
}

async function resolveFont(style) {
  const familyCandidates = [style.fontFamily, ...FONT_FAMILY_CANDIDATES].filter(Boolean);
  const styleCandidates = FONT_STYLE_CANDIDATES[normalizeWeight(style.fontWeight)] || ["Regular"];

  for (const family of familyCandidates) {
    for (const fontStyle of styleCandidates) {
      try {
        return await ensureFontLoaded({ family, style: fontStyle });
      } catch (error) {
        // Try the next candidate.
      }
    }
  }

  return ensureFontLoaded({ family: "Inter", style: "Regular" });
}

function toSolidPaint(color, opacity = 1) {
  if (!color) return null;
  return {
    type: "SOLID",
    color: {
      r: clamp(color.r, 0, 255) / 255,
      g: clamp(color.g, 0, 255) / 255,
      b: clamp(color.b, 0, 255) / 255,
    },
    opacity: opacity == null ? 1 : clamp(opacity, 0, 1),
  };
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function createImageFill(base64) {
  const image = figma.createImage(base64ToBytes(base64));
  return {
    type: "IMAGE",
    imageHash: image.hash,
    scaleMode: "FILL",
  };
}

function hasVisiblePaint(shapeItem) {
  return Boolean(shapeItem && (shapeItem.fill || shapeItem.stroke));
}

function isMeaningfulText(text) {
  return typeof text === "string" && text.replace(/\s+/g, "").length > 0;
}

function mapTextAlign(value) {
  switch (value) {
    case "center":
      return "CENTER";
    case "right":
      return "RIGHT";
    case "justify":
      return "JUSTIFIED";
    default:
      return "LEFT";
  }
}

function inferLineCount(textItem) {
  const explicitLineBreakCount = String(textItem.characters || "").split("\n").length;
  if (explicitLineBreakCount > 1) return explicitLineBreakCount;

  const lineHeight = textItem.style.lineHeightPx || textItem.style.fontSize || 16;
  const measuredHeight = textItem.height || lineHeight;
  return Math.max(1, Math.round(measuredHeight / Math.max(1, lineHeight)));
}

async function createTextLayer(frame, textItem) {
  if (!isMeaningfulText(textItem.characters)) return null;

  const textNode = figma.createText();
  const fontName = await resolveFont(textItem.style);
  const inferredLineCount = inferLineCount(textItem);
  const shouldPreserveBoxWidth = inferredLineCount > 1;

  textNode.fontName = fontName;
  textNode.characters = textItem.characters;
  textNode.fontSize = Math.max(1, textItem.style.fontSize || 16);
  textNode.textAlignHorizontal = mapTextAlign(textItem.style.textAlign);
  textNode.textAutoResize = shouldPreserveBoxWidth ? "HEIGHT" : "WIDTH_AND_HEIGHT";

  if (textItem.style.lineHeightPx) {
    textNode.lineHeight = {
      unit: "PIXELS",
      value: Math.max(1, textItem.style.lineHeightPx),
    };
  } else {
    textNode.lineHeight = { unit: "AUTO" };
  }

  if (typeof textItem.style.letterSpacingPx === "number") {
    textNode.letterSpacing = {
      unit: "PIXELS",
      value: textItem.style.letterSpacingPx,
    };
  }

  const fill = toSolidPaint(textItem.style.color, textItem.style.opacity);
  if (fill) textNode.fills = [fill];

  if (shouldPreserveBoxWidth) {
    textNode.resize(
      Math.max(1, Math.ceil((textItem.width || 1) + Math.max(8, (textItem.style.fontSize || 16) * 0.3))),
      Math.max(1, (textItem.height || textItem.style.fontSize || 16) + 4)
    );
  }

  textNode.x = textItem.x;
  textNode.y = textItem.y;

  frame.appendChild(textNode);
  return textNode;
}

function createShapeLayer(frame, shapeItem, index) {
  if (!hasVisiblePaint(shapeItem)) return null;

  const shapeNode = figma.createRectangle();
  shapeNode.name = `Shape ${String(index + 1).padStart(2, "0")}`;
  shapeNode.resize(Math.max(1, shapeItem.width || 1), Math.max(1, shapeItem.height || 1));
  shapeNode.x = shapeItem.x || 0;
  shapeNode.y = shapeItem.y || 0;
  shapeNode.opacity = shapeItem.opacity == null ? 1 : clamp(shapeItem.opacity, 0, 1);

  const borderRadius = shapeItem.borderRadius || {};
  shapeNode.topLeftRadius = Math.max(0, borderRadius.topLeft || 0);
  shapeNode.topRightRadius = Math.max(0, borderRadius.topRight || 0);
  shapeNode.bottomRightRadius = Math.max(0, borderRadius.bottomRight || 0);
  shapeNode.bottomLeftRadius = Math.max(0, borderRadius.bottomLeft || 0);

  const fills = [];
  if (shapeItem.fill) {
    const fill = toSolidPaint(shapeItem.fill, shapeItem.fill.a);
    if (fill) fills.push(fill);
  }
  shapeNode.fills = fills;

  if (shapeItem.stroke && (shapeItem.strokeWidth || 0) > 0) {
    const stroke = toSolidPaint(shapeItem.stroke, shapeItem.stroke.a);
    shapeNode.strokes = stroke ? [stroke] : [];
    shapeNode.strokeWeight = Math.max(1, shapeItem.strokeWidth || 1);
    if (shapeItem.strokeStyle === "dashed") {
      shapeNode.dashPattern = [8, 6];
    }
  } else {
    shapeNode.strokes = [];
  }

  frame.appendChild(shapeNode);
  return shapeNode;
}

function createBackgroundNode(frame, slide) {
  const backgroundNode = figma.createRectangle();
  backgroundNode.name = "Background";
  backgroundNode.resize(slide.width, slide.height);
  backgroundNode.x = 0;
  backgroundNode.y = 0;

  const fills = [];
  if (slide.backgroundColor) {
    const backgroundOpacity =
      slide.backgroundColor.a === undefined || slide.backgroundColor.a === null
        ? 1
        : slide.backgroundColor.a;
    const backgroundFill = toSolidPaint(slide.backgroundColor, backgroundOpacity);
    if (backgroundFill) fills.push(backgroundFill);
  }
  if (slide.backgroundImageBase64) {
    fills.push(createImageFill(slide.backgroundImageBase64));
  }
  backgroundNode.fills = fills.length ? fills : [];
  backgroundNode.locked = true;

  frame.appendChild(backgroundNode);
  return backgroundNode;
}

async function importSlides(payload) {
  const { slides, sourceName } = payload;
  if (!Array.isArray(slides) || !slides.length) {
    figma.notify("가져올 슬라이드가 없습니다.");
    return;
  }

  const createdFrames = [];
  let cursorY = 0;

  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index];
    const frame = figma.createFrame();
    frame.name = slide.name || `Slide ${String(index + 1).padStart(2, "0")}`;
    frame.resizeWithoutConstraints(slide.width, slide.height);
    frame.clipsContent = true;
    frame.x = 0;
    frame.y = cursorY;

    createBackgroundNode(frame, slide);

    const shapeItems = Array.isArray(slide.shapes) ? slide.shapes : [];
    for (let shapeIndex = 0; shapeIndex < shapeItems.length; shapeIndex += 1) {
      createShapeLayer(frame, shapeItems[shapeIndex], shapeIndex);
    }

    const textItems = Array.isArray(slide.texts) ? slide.texts : [];
    for (const textItem of textItems) {
      await createTextLayer(frame, textItem);
    }

    createdFrames.push(frame);
    cursorY += slide.height + 120;
  }

  figma.currentPage.selection = createdFrames;
  figma.viewport.scrollAndZoomIntoView(createdFrames);
  figma.notify(`${sourceName || "HTML"}에서 ${createdFrames.length}개 슬라이드를 가져왔습니다.`);
}

figma.ui.onmessage = async (message) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "IMPORT_DECK") {
    try {
      await importSlides(message.payload);
    } catch (error) {
      figma.notify("슬라이드 생성 중 오류가 발생했습니다.");
      figma.ui.postMessage({
        type: "IMPORT_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (message.type === "CLOSE_PLUGIN") {
    figma.closePlugin();
  }
};

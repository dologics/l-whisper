// Renders the "L - Whisper" app icon: a white bold-Fraktur 𝕷 (gothic L, a nod to L from
// Death Note) on a near-black rounded square. Writes a 1024×1024 PNG.
// Used by scripts/make-app-icon.sh (which builds assets/icon.icns from it).
// Run: swift scripts/make-app-icon.swift out.png
import AppKit

let size: CGFloat = 1024
let glyph = "𝕷" // U+1D577 MATHEMATICAL BOLD FRAKTUR CAPITAL L
let font = NSFont(name: "STIXTwoMath-Regular", size: size * 0.62)! // ships with macOS

let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()

// macOS icon grid: ~10 % margin, corner radius ~22 % of the square.
let square = NSRect(x: size * 0.1, y: size * 0.1, width: size * 0.8, height: size * 0.8)
let shape = NSBezierPath(roundedRect: square, xRadius: size * 0.18, yRadius: size * 0.18)
NSGradient(starting: NSColor(white: 0.16, alpha: 1), ending: NSColor(white: 0.03, alpha: 1))!
    .draw(in: shape, angle: -90) // subtle top-to-bottom shading

// Centre the letter by its actual ink (glyph path bounds), not its font box.
let text = NSAttributedString(string: glyph, attributes: [.font: font, .foregroundColor: NSColor.white])
let line = CTLineCreateWithAttributedString(text)
let ink = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
let ctx = NSGraphicsContext.current!.cgContext
ctx.textPosition = CGPoint(x: square.midX - ink.midX, y: square.midY - ink.midY)
CTLineDraw(line, ctx)

image.unlockFocus()
let png = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
print("rendered \(CommandLine.arguments[1])")

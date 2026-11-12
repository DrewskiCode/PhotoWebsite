// Subject mask with Apple's Vision framework (macOS 14+).
//   swift tools/cutout.swift <input image> <output mask png> [maxSide]
// Writes ONLY a greyscale mask (white = subject). The photograph's own pixels are
// never touched here, so colour and sharpness stay exactly as shot.
import Foundation
import Vision
import CoreImage

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: cutout.swift in out [maxSide]"); exit(2) }
let maxSide = args.count > 3 ? CGFloat(Double(args[3]) ?? 4096) : 4096
guard var image = CIImage(contentsOf: URL(fileURLWithPath: args[1]), options: [.applyOrientationProperty: true]) else { print("cannot read"); exit(1) }
let scale = min(1, maxSide / max(image.extent.width, image.extent.height))
if scale < 1 { image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) }
let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: image)
try handler.perform([request])
guard let result = request.results?.first else { print("NOSUBJECT"); exit(3) }
let buffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
let mask = CIImage(cvPixelBuffer: buffer)
let ctx = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
try ctx.writePNGRepresentation(of: mask, to: URL(fileURLWithPath: args[2]), format: .L8, colorSpace: CGColorSpace(name: CGColorSpace.linearGray)!)
print("OK \(Int(mask.extent.width))x\(Int(mask.extent.height)) instances \(result.allInstances.count)")

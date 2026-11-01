// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "KITTKit",
    platforms: [
        .iOS(.v26),
        .macOS(.v15),
        .tvOS(.v26)
    ],
    products: [
        .library(name: "KITTKit", targets: ["KITTKit"])
    ],
    targets: [
        .target(name: "KITTKit"),
        .testTarget(name: "KITTKitTests", dependencies: ["KITTKit"])
    ]
)

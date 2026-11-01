import SwiftUI

extension View {
    /// Text-entry hints for the hub address. iOS-only modifiers are skipped on macOS, where they do not exist.
    func hubURLEntry() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never).keyboardType(.URL).autocorrectionDisabled()
        #else
        self.autocorrectionDisabled()
        #endif
    }

    /// Text-entry hints for a secret such as the app token.
    func secretEntry() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self.autocorrectionDisabled()
        #endif
    }
}

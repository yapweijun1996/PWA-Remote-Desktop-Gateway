import Foundation
import Security

/// Shared secret between the agent and its single authorised client. 32 random bytes, base64url, in a 0600 file.
/// The value is never logged, printed or placed in a URL.
enum Token {
    static let byteCount = 32

    static func defaultPath() -> String {
        let base = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/RDG")
        return base.appendingPathComponent("agent.token").path
    }

    /// Creates the token file only if it does not exist yet; never replaces an existing secret.
    static func createIfAbsent(at path: String) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: path) { return }
        let directory = (path as NSString).deletingLastPathComponent
        try fm.createDirectory(atPath: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var bytes = [UInt8](repeating: 0, count: byteCount)
        guard SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes) == errSecSuccess else { throw AgentError.tokenUnavailable }
        let text = Data(bytes).base64URLEncoded()
        bytes.withUnsafeMutableBufferPointer { $0.initialize(repeating: 0) }
        guard fm.createFile(atPath: path, contents: Data(text.utf8), attributes: [.posixPermissions: 0o600]) else {
            throw AgentError.tokenUnavailable
        }
    }

    /// Loads the secret, refusing a file that is not a regular 0600 file owned by this user.
    static func load(from path: String) throws -> Data {
        var info = stat()
        guard lstat(path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_uid == getuid(),
              (info.st_mode & 0o077) == 0 else { throw AgentError.tokenUnavailable }
        let text = try String(contentsOfFile: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = Data(base64URLEncoded: text), data.count == byteCount else { throw AgentError.tokenUnavailable }
        return data
    }

    static func matches(_ candidate: String, expected: Data) -> Bool {
        guard let given = Data(base64URLEncoded: candidate), given.count == expected.count else { return false }
        var difference: UInt8 = 0
        for (a, b) in zip(given, expected) { difference |= a ^ b }
        return difference == 0
    }
}

enum AgentError: Error {
    case tokenUnavailable
    case captureUnavailable(String)
    case encoderUnavailable(Int32)
}

extension Data {
    func base64URLEncoded() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLEncoded text: String) {
        guard text.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }), text.count <= 128 else { return nil }
        var standard = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while standard.count % 4 != 0 { standard += "=" }
        self.init(base64Encoded: standard)
    }
}

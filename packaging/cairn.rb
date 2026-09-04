# Homebrew formula — lives in the tap repo (R0kshan/homebrew-tap).
# The release workflow rewrites version, URLs and sha256 on every tag.
class Cairn < Formula
  desc "Architecture diagrams as code — typed views, semantic layout, no label overlap"
  homepage "https://github.com/R0kshan/cairn"
  version "0.1.0"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/R0kshan/cairn/releases/download/v#{version}/cairn-#{version}-darwin-arm64"
      sha256 "REPLACED_BY_RELEASE_WORKFLOW"
    end
    on_intel do
      url "https://github.com/R0kshan/cairn/releases/download/v#{version}/cairn-#{version}-darwin-x64"
      sha256 "REPLACED_BY_RELEASE_WORKFLOW"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/R0kshan/cairn/releases/download/v#{version}/cairn-#{version}-linux-arm64"
      sha256 "REPLACED_BY_RELEASE_WORKFLOW"
    end
    on_intel do
      url "https://github.com/R0kshan/cairn/releases/download/v#{version}/cairn-#{version}-linux-x64"
      sha256 "REPLACED_BY_RELEASE_WORKFLOW"
    end
  end

  # The binary inlines elkjs (EPL-2.0) and the Simple Icons artwork, and
  # `bun build --compile` embeds the Bun runtime — which statically links
  # JavaScriptCore, LGPL-2.1 in part. So the notices are not optional extras:
  # EPL-2.0 §3.1(b) wants a copy of the Agreement alongside each copy of the
  # program, LGPL-2.1 §6 wants the relink offer, and six vendored icons carry
  # terms that require attribution.
  #
  # One tarball rather than a resource per text, so adding a licence never means
  # editing this formula. Rendered with its checksum by
  # scripts/render-packaging.mjs, from the same checksums file as the binaries.
  resource "licenses" do
    url "https://github.com/R0kshan/cairn/releases/download/v#{version}/cairn-#{version}-licenses.tar.gz"
    sha256 "REPLACED_BY_RELEASE_WORKFLOW"
  end

  def install
    bin.install Dir["cairn-*"].first => "cairn"
    # The archive is flat — LICENSE, THIRD-PARTY-NOTICES.md and licenses/ — so
    # `brew list cairn` shows the notices under share/doc/cairn.
    # `cairn version --licenses` prints the short form from inside the binary
    # either way.
    resource("licenses").stage { doc.install Dir["*"] }
  end

  test do
    system bin/"cairn", "explain", "E0203"
  end
end

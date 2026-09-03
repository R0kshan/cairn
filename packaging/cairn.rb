# Homebrew formula — lives in the tap repo (R0kshan/homebrew-tap).
# The release workflow rewrites version, URLs and sha256 on every tag.
class Cairn < Formula
  desc "Architecture diagrams as code — typed views, semantic layout, overlap-free labels"
  homepage "https://github.com/R0kshan/cairn"
  version "0.1.0"
  license "Apache-2.0"

  # The binary inlines elkjs (EPL-2.0) and the Simple Icons artwork, so the
  # licence texts travel with it: EPL-2.0 §3.1(b) wants a copy of the Agreement
  # alongside each copy of the program, and six of the vendored icons are under
  # terms that require attribution. Rendered with their checksums by
  # scripts/render-packaging.mjs, same as the binaries.
  resource "LICENSE" do
    url "https://github.com/R0kshan/cairn/releases/download/v#{version}/LICENSE"
    sha256 "REPLACED_BY_RELEASE_WORKFLOW"
  end

  resource "THIRD-PARTY-NOTICES.md" do
    url "https://github.com/R0kshan/cairn/releases/download/v#{version}/THIRD-PARTY-NOTICES.md"
    sha256 "REPLACED_BY_RELEASE_WORKFLOW"
  end

  resource "elkjs-EPL-2.0.md" do
    url "https://github.com/R0kshan/cairn/releases/download/v#{version}/elkjs-EPL-2.0.md"
    sha256 "REPLACED_BY_RELEASE_WORKFLOW"
  end

  resource "simple-icons-CC0-1.0.md" do
    url "https://github.com/R0kshan/cairn/releases/download/v#{version}/simple-icons-CC0-1.0.md"
    sha256 "REPLACED_BY_RELEASE_WORKFLOW"
  end

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

  def install
    bin.install Dir["cairn-*"].first => "cairn"
    %w[LICENSE THIRD-PARTY-NOTICES.md elkjs-EPL-2.0.md simple-icons-CC0-1.0.md].each do |name|
      resource(name).stage { doc.install name }
    end
  end

  test do
    system bin/"cairn", "explain", "E0203"
  end
end

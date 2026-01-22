#!/bin/bash

echo "🔐 Mac Secure Enclave & WebAuthn Support Checker"
echo "================================================="
echo ""

# Check Mac model
echo "📱 Hardware Information:"
echo "------------------------"
system_profiler SPHardwareDataType | grep -E "Model Name|Model Identifier|Chip|Processor Name" | sed 's/^      //'
echo ""

# Check for Apple Silicon
if system_profiler SPHardwareDataType | grep -q "Apple M"; then
    echo "✅ Apple Silicon detected (M1/M2/M3/M4)"
    echo "   Secure Enclave: Built into Apple Silicon SoC"
    CHIP_TYPE="Apple Silicon"
elif system_profiler SPiBridgeDataType 2>/dev/null | grep -q "T2"; then
    echo "✅ Apple T2 Security Chip detected"
    T2_VERSION=$(system_profiler SPiBridgeDataType 2>/dev/null | grep "Firmware Version" | awk '{print $3}')
    echo "   T2 Firmware: ${T2_VERSION}"
    echo "   Secure Enclave: Integrated in T2 chip"
    CHIP_TYPE="Intel + T2"
else
    echo "❌ No Secure Enclave detected"
    echo "   This Mac does not have T2 or Apple Silicon"
    CHIP_TYPE="Legacy Intel"
fi

echo ""
echo "🔑 Expected WebAuthn Algorithm Support:"
echo "---------------------------------------"

case "$CHIP_TYPE" in
    "Apple Silicon")
        echo "✅ P-256 (ES256, alg: -7)     - ALWAYS SUPPORTED"
        echo "⚠️  Ed25519 (EdDSA, alg: -8)   - macOS 14+ & Safari 17+"
        echo "⚠️  Ed25519 (alg: -50)         - Chrome 108+ or Safari 17+"
        echo "✅ RSA (RS256, alg: -257)     - Supported (not recommended)"
        ;;
    "Intel + T2")
        echo "✅ P-256 (ES256, alg: -7)     - ALWAYS SUPPORTED"
        echo "❌ Ed25519 (EdDSA, alg: -8)   - NOT supported on T2"
        echo "❌ Ed25519 (alg: -50)         - NOT supported on T2"
        echo "✅ RSA (RS256, alg: -257)     - Supported (not recommended)"
        ;;
    *)
        echo "❌ No hardware-backed WebAuthn support"
        ;;
esac

echo ""
echo "🌐 Browser Support:"
echo "------------------"
echo "Safari:  WebAuthn platform authenticator (Touch ID)"
echo "Chrome:  WebAuthn platform authenticator (Touch ID)"
echo "Firefox: Limited platform authenticator support on macOS"

echo ""
echo "📋 macOS Version:"
sw_vers

echo ""
echo "🧪 To test actual browser support, open:"
echo "   file://$(pwd)/test-secure-enclave.html"
echo ""
echo "💡 Key Findings:"
echo "   • Your Mac $(system_profiler SPHardwareDataType | grep "Model Name" | awk -F: '{print $2}' | xargs)"
echo "   • Chip: $CHIP_TYPE"

if [ "$CHIP_TYPE" = "Intel + T2" ]; then
    echo "   • T2 chip supports P-256 (ES256) ONLY for WebAuthn"
    echo "   • Ed25519 requires Apple Silicon (M1+) with macOS 14+"
    echo ""
    echo "⚠️  For your project:"
    echo "   → Hardware mode will use P-256 (not Ed25519)"
    echo "   → This is expected and secure (just different algorithm)"
    echo "   → P-256 with varsig works perfectly for UCAN signing"
fi

echo ""

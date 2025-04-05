const { getDefaultConfig } = require('@expo/metro-config');

module.exports = (async () => {
    const config = await getDefaultConfig(__dirname);
    const { assetExts } = config.resolver;
    // Add 'onnx' extension so Metro can bundle your ONNX files as assets.
    config.resolver.assetExts = [...assetExts, 'onnx'];
    return config;
})();

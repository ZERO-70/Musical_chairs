// Test script for manual tensor validation
// Add this to your CameraScreen.tsx for testing

async function testTensorWithKnownImage() {
    try {
        // Use a known image from your assets
        const testImageUri = 'file:///android_asset/images/react-logo.png';
        console.log('🧪 Testing tensor conversion with known image...');
        
        const testTensor = await imageToTensor(testImageUri);
        validateTensor(testTensor, "Test Image Tensor");
        await validateImageTensorContent(testTensor, testImageUri);
        visualizeTensorAsASCII(testTensor, 15);
        
        console.log('✅ Test completed - check logs above');
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Call this function once when the camera screen loads to test
// testTensorWithKnownImage();

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function WelcomeScreen() {
  const router = useRouter();
  
  // Animated values
  const colorAnimation = useRef(new Animated.Value(0)).current;
  const scaleAnimation = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // 1. Color animation (must be JS-driven for color interpolation)
    Animated.loop(
      Animated.timing(colorAnimation, {
        toValue: 3,
        duration: 7000,
        useNativeDriver: false, // Keep this false for color interpolation
      })
    ).start();
    
    // 2. Scale animation (set to false to avoid conflict)
    Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnimation, {
          toValue: 1.1,
          duration: 500,
          useNativeDriver: false, // Change this to false
        }),
        Animated.timing(scaleAnimation, {
          toValue: 1,
          duration: 500,
          useNativeDriver: false, // Change this to false
        }),
      ])
    ).start();
  }, [colorAnimation, scaleAnimation]);

  // Color interpolation
  const animatedColor = colorAnimation.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: [
      'rgb(255, 20, 20)', 
      'rgb(149, 0, 255)', 
      'rgb(255, 221, 0)', 
      'rgb(255,105,180)',
    ],
  });

  return (
    <ImageBackground
      source={{
        uri: 'https://api.a0.dev/assets/image?text=musical%20chairs%20game%20neon%20party%20background&aspect=9:16',
      }}
      style={styles.container}
      resizeMode="cover"
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Animated.Text
            style={[
              styles.title,
              { 
                color: animatedColor,
                transform: [{ scale: scaleAnimation }],
              },
            ]}
          >
            MUSICAL CHAIRS
          </Animated.Text>
          <Text style={styles.subtitle}>Are You Ready to Party?</Text>

          <TouchableOpacity
            style={styles.playButton}
            onPress={() => router.push('/CameraScreen')}
          >
            <MaterialIcons name="play-circle-filled" size={40} color="#fff" />
            <Text style={styles.buttonText}>START GAME</Text>
          </TouchableOpacity>

          <View style={styles.instructionsContainer}>
            <Text style={styles.instructionsTitle}>How to Play</Text>
            <Text style={styles.instructionsText}>• Set up chairs in a circle</Text>
            <Text style={styles.instructionsText}>• Choose a funky track</Text>
            <Text style={styles.instructionsText}>
              • Dance as long as the music plays
            </Text>
            <Text style={styles.instructionsText}>• Sit fast when it stops!</Text>
          </View>
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  content: {
    width: '100%',
    alignItems: 'center',
  },
  title: {
    fontSize: 48,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 4,
    textShadowColor: 'black',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  subtitle: {
    fontSize: 24,
    fontWeight: '600',
    color: 'rgb(255, 255, 255)',
    marginBottom: 30,
    textAlign: 'center',
    textShadowColor: 'yellow',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 20,
  },
  playButton: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 20, 20, 0.7)',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 50,
    alignItems: 'center',
    marginBottom: 40,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#ff1493',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    marginLeft: 10,
    letterSpacing: 1,
    textShadowColor: '#ff1493',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
  instructionsContainer: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    padding: 20,
    borderRadius: 15,
    width: '100%',
    maxWidth: 320,
  },
  instructionsTitle: {
    color: '#ff69b4',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 1,
    textShadowColor: '#ff69b4',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
  instructionsText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 8,
    lineHeight: 24,
    letterSpacing: 0.5,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
});

export { WelcomeScreen };

import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
  ScrollView,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ScreenOrientation from "expo-screen-orientation";
import { Audio, Video } from "expo-av";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";

const ITEM_HEIGHT = 80;
const ITEM_MARGIN = 10;
const SNAP_INTERVAL = ITEM_HEIGHT + ITEM_MARGIN * 2;

export default function CameraScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  // Ref to hold the music instance.
  const soundRef = useRef<Audio.Sound | null>(null);
  // Ref to store the current playback position (in milliseconds)
  const playbackPositionRef = useRef<number>(0);
  const [cameraFacing, setCameraFacing] = useState<"front" | "back">("back");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [showWarning, setShowWarning] = useState<boolean>(false);
  // State for showing the number selector overlay.
  const [showNumberSelector, setShowNumberSelector] = useState<boolean>(false);
  // The selected number (number of chairs)
  const [selectedNumber, setSelectedNumber] = useState<number>(1);
  // State for game over (when chairs reach zero)
  const [gameOver, setGameOver] = useState<boolean>(false);
  // Animated values for countdown
  const fadeAnim = new Animated.Value(1);
  const scaleAnim = new Animated.Value(1);
  // State for showing the intro video.
  const [showIntroVideo, setShowIntroVideo] = useState<boolean>(true);

  // Reference for the vertical ScrollView
  const scrollViewRef = useRef<ScrollView>(null);

  // Helper: Wait for a sound to finish playing.
  const waitForSoundToFinish = (sound: Audio.Sound) => {
    return new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if ("isLoaded" in status && status.isLoaded && status.didJustFinish) {
          sound.setOnPlaybackStatusUpdate(null);
          resolve();
        }
      });
    });
  };

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission]);

  useEffect(() => {
    async function requestAudioPermissions() {
      const { status } = await Audio.requestPermissionsAsync();
      console.log(status !== "granted" ? "Audio permission denied" : "Audio permission granted");
    }
    requestAudioPermissions();
  }, []);

  async function playSound() {
    try {
      console.log("Attempting to play music...");
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      if (soundRef.current) {
        console.log("Resuming music...");
        await soundRef.current.playAsync();
      } else {
        const { sound: newSound } = await Audio.Sound.createAsync(
          require("../../assets/song.mp3"),
          { shouldPlay: true }
        );
        if (playbackPositionRef.current > 0) {
          await newSound.setStatusAsync({ positionMillis: playbackPositionRef.current });
          console.log("Restored playback position:", playbackPositionRef.current);
        }
        soundRef.current = newSound;
        console.log("Playing new music...");
      }
      const randomDelay = Math.floor(Math.random() * 10000) + 10000;
      setTimeout(randomStop, randomDelay);
    } catch (error) {
      console.error("Error playing music:", error);
    }
  }

  async function randomStop() {
    console.log("Random stop triggered");
    if (soundRef.current) {
      const status = await soundRef.current.getStatusAsync();
      if ("isLoaded" in status && status.isLoaded) {
        playbackPositionRef.current = status.positionMillis;
        console.log("Saved playback position:", playbackPositionRef.current);
      }
      console.log("Pausing music...");
      await soundRef.current.pauseAsync();
    }
    setTimeout(startSettleCountdown, 500);
  }

  function startSettleCountdown() {
    // Clear any existing interval.
    setCountdown(10);
    let count = 10;
    const interval = setInterval(() => {
      count -= 1;
      if (count < 0) {
        clearInterval(interval);
        setCountdown(null);
        // Deduct one chair if possible. If only one remains, game over.
        if (selectedNumber <= 1) {
          // Deducting the last chair triggers game over.
          setSelectedNumber(0);
          setGameOver(true);
          // Display winner message for 5 seconds then reset.
          setTimeout(() => {
            resetGame();
          }, 5000);
        } else {
          setSelectedNumber((prev) => prev - 1);
          // Continue with warning sound and resume music.
          (async () => {
            console.log("Countdown finished. Playing warning sound...");
            setShowWarning(true);
            const { sound: warningSound } = await Audio.Sound.createAsync(
              require("../../assets/danger.mp3"),
              { shouldPlay: true }
            );
            await waitForSoundToFinish(warningSound);
            await warningSound.unloadAsync();
            setShowWarning(false);
            if (soundRef.current) {
              const status = await soundRef.current.getStatusAsync();
              if ("isLoaded" in status && status.isLoaded && !status.isPlaying) {
                await soundRef.current.playAsync();
                console.log("Music resumed.");
              } else {
                console.log("Music is either not loaded or already playing.");
              }
            } else {
              console.log("Music reference is null. Recreating music...");
              const { sound: newSound } = await Audio.Sound.createAsync(
                require("../../assets/song.mp3"),
                { shouldPlay: false }
              );
              if (playbackPositionRef.current > 0) {
                await newSound.setStatusAsync({ positionMillis: playbackPositionRef.current });
                console.log("Restored playback position to:", playbackPositionRef.current);
              }
              soundRef.current = newSound;
              await newSound.playAsync();
              console.log("Music recreated and resumed.");
            }
          })();
        }
      } else {
        setCountdown(count);
        animateCountdown();
      }
    }, 1000);
  }

  // Recursive animation for countdown display.
  const animateCountdown = () => {
    fadeAnim.setValue(1);
    scaleAnim.setValue(1);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 900,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 2,
        duration: 900,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Starts the game countdown (5 seconds) after a number is selected.
  const startGameCountdown = () => {
    let count = 5;
    setCountdown(count);
    const interval = setInterval(() => {
      count -= 1;
      if (count < 0) {
        clearInterval(interval);
        setCountdown(null);
        playSound();
        playbackPositionRef.current = 0;
      } else {
        setCountdown(count);
        animateCountdown();
      }
    }, 1000);
  };

  const handleStartCancel = () => {
    if (isActive) {
      // Cancel game.
      setCountdown(null);
      if (soundRef.current) {
        console.log("Cancelling game: stopping and unloading music.");
        soundRef.current.stopAsync();
        soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      setIsActive(false);
      setShowNumberSelector(false);
    } else {
      // Start game.
      setIsActive(true);
      // Show number selector overlay. Game countdown will start after a number is selected.
      setShowNumberSelector(true);
    }
  };

  const toggleCamera = () => {
    setCameraFacing((prev) => (prev === "back" ? "front" : "back"));
  };

  const resetGame = () => {
    // Reset game state.
    setIsActive(false);
    setShowNumberSelector(false);
    setCountdown(null);
    setGameOver(false);
    // Optionally, reset selectedNumber to an initial value.
    setSelectedNumber(1);
  };

  useFocusEffect(
    React.useCallback(() => {
      return () => {
        if (soundRef.current) {
          console.log("Navigating away: Stopping and unloading music.");
          soundRef.current.stopAsync();
          soundRef.current.unloadAsync();
          soundRef.current = null;
        }
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        router.replace("/");
      };
    }, [])
  );

  // Back button handler.
  const handleBack = () => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    router.replace("/");
  };

  if (showIntroVideo) {
    return (
      <View style={styles.videoContainer}>
        <Video
          source={require("../../assets/intro.mp4")}
          style={styles.video}
          shouldPlay
          resizeMode="cover"
          onPlaybackStatusUpdate={(status) => {
            if (status.didJustFinish) {
              ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
              setShowIntroVideo(false);
            }
          }}
        />
      </View>
    );
  }

  if (!permission) {
    return (
      <View>
        <Text>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text>No access to camera</Text>
        <Text>Please grant camera permission in settings.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing={cameraFacing}
        videoStabilizationMode="auto"
      />

      {/* Back Button */}
      <TouchableOpacity style={styles.backButton} onPress={handleBack}>
        <Image source={require("../../assets/reply.png")} style={styles.backIcon} />
      </TouchableOpacity>

      {/* Countdown Display */}
      {countdown !== null && (
        <View style={styles.countdownContainer}>
          <Animated.Text style={[styles.countdownText, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
            {countdown}
          </Animated.Text>
        </View>
      )}

      {/* Neon Warning Overlay */}
      {showWarning && (
        <View style={styles.warningContainer}>
          <Text style={styles.warningText}>GAME IS RESUMING</Text>
        </View>
      )}

      {/* Winner Overlay */}
      {gameOver && (
        <View style={styles.gameOverOverlay}>
          <Text style={styles.gameOverText}>Congratulations Winner</Text>
        </View>
      )}

      {/* Start/Cancel Button */}
      <TouchableOpacity style={[styles.startButton, isActive ? { backgroundColor: "rgba(255, 0, 0, 0.3)" } : {}]} onPress={handleStartCancel}>
        <Image source={isActive ? require("../../assets/close.png") : require("../../assets/play.png")} style={styles.startIcon} />
      </TouchableOpacity>

      {/* Camera Toggle Button */}
      <TouchableOpacity style={styles.toggleButton} onPress={toggleCamera}>
        <Image source={require("../../assets/switch-camera.png")} style={styles.switchIcon} />
      </TouchableOpacity>

      {/* Vertical Number Selector Overlay */}
      {isActive && showNumberSelector && (
        <View style={styles.numberSelectorContainer}>
          <Text style={styles.numberSelectorInstruction}>Scroll to Select</Text>
          <ScrollView
            ref={scrollViewRef}
            showsVerticalScrollIndicator={false}
            snapToInterval={SNAP_INTERVAL}
            decelerationRate="fast"
            onMomentumScrollEnd={(event) => {
              const offsetY = event.nativeEvent.contentOffset.y;
              const index = Math.round(offsetY / SNAP_INTERVAL);
              setSelectedNumber(index + 1);
            }}
          >
            {Array.from({ length: 20 }).map((_, index) => {
              const number = index + 1;
              const isSelected = number === selectedNumber;
              return (
                <TouchableOpacity
                  key={index}
                  activeOpacity={0.7}
                  onPress={() => {
                    setSelectedNumber(number);
                    setShowNumberSelector(false);
                    startGameCountdown();
                  }}
                >
                  <View style={[styles.numberItem, isSelected && styles.selectedNumberItem]}>
                    <Text style={[styles.numberText, isSelected && styles.selectedNumberText]}>
                      {number}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {/* Down arrow icon below the scroller */}
          <Image source={require("../../assets/down-arrow.png")} style={styles.downArrowIcon} />
        </View>
      )}

      {/* Display the selected number with chair icon in bottom left corner */}
      {isActive && !showNumberSelector && (
        <View style={styles.selectedNumberDisplay}>
          <Image source={require("../../assets/chair.png")} style={styles.chairIcon} />
          <Text style={styles.selectedNumberText}>{selectedNumber}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  switchIcon: { width: 40, height: 40, resizeMode: "contain" },
  camera: { flex: 1, width: "100%" },
  permissionContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  videoContainer: { flex: 1, backgroundColor: "black", justifyContent: "center", alignItems: "center" },
  video: { width: "100%", height: "100%" },
  backButton: {
    position: "absolute",
    top: 40,
    left: 20,
    backgroundColor: "rgba(255, 192, 74, 0.5)",
    borderWidth: 2,
    borderColor: "white",
    paddingVertical: 20,
    paddingHorizontal: 25,
    borderRadius: 40,
  },
  backIcon: { width: 40, height: 40, resizeMode: "contain" },
  startButton: {
    position: "absolute",
    bottom: 130,
    right: 30,
    backgroundColor: "rgba(115, 255, 148, 0.3)",
    padding: 20,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: "white",
    justifyContent: "center",
    alignItems: "center",
    width: 120,
    height: 120,
  },
  toggleButton: {
    position: "absolute",
    bottom: 30,
    right: 40,
    backgroundColor: "rgba(100, 177, 255, 0.3)",
    padding: 15,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: "white",
    justifyContent: "center",
    alignItems: "center",
    width: 80,
    height: 80,
  },
  countdownContainer: {
    position: "absolute",
    top: "40%",
    left: "50%",
    transform: [{ translateX: -50 }, { translateY: -50 }],
  },
  countdownText: { fontSize: 120, fontWeight: "bold", color: "rgba(255, 255, 255, 0.8)", textAlign: "center" },
  warningContainer: {
    position: "absolute",
    top: "50%",
    left: "25%",
    transform: [{ translateX: -50 }, { translateY: -50 }],
    backgroundColor: "rgba(255,0,0,0.5)",
    padding: 20,
    borderRadius: 10,
  },
  warningText: { color: "#fff", fontSize: 40, fontWeight: "bold", textAlign: "center", textShadowColor: "#ff0000", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20 },
  startIcon: { width: 40, height: 40, resizeMode: "contain" },
  numberSelectorContainer: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: ITEM_HEIGHT + ITEM_MARGIN * 2,
    height: "50%",
    transform: [{ translateX: -(ITEM_HEIGHT + ITEM_MARGIN * 2) / 2 }, { translateY: -100 }],
  },
  numberSelectorInstruction: {
    position: "absolute",
    top: -40,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 16,
    color: "white",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingVertical: 4,
    borderRadius: 4,
    zIndex: 1,
  },
  numberItem: { height: ITEM_HEIGHT, marginVertical: ITEM_MARGIN, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10 },
  numberText: { fontSize: 24, color: "white" },
  selectedNumberItem: { backgroundColor: "rgba(255,255,255,0.6)" },
  selectedNumberDisplay: {
    position: "absolute",
    bottom: 20,
    left: 20,
    backgroundColor: "rgba(255,255,255,0.8)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  chairIcon: {
    width: 30,
    height: 30,
    marginRight: 8,
  },
  selectedNumberText: { fontSize: 24, color: "black", fontWeight: "bold" },
  downArrowIcon: {
    width: 30,
    height: 30,
    alignSelf: "center",
    marginTop: 10,
    tintColor: "white",
  },
  gameOverOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  gameOverText: {
    fontSize: 32,
    color: "white",
    fontWeight: "bold",
  },
});


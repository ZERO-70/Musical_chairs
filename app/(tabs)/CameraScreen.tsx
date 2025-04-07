import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
  ScrollView,
  Modal,
} from "react-native";
import { Camera, CameraView, useCameraPermissions } from "expo-camera";
import * as ScreenOrientation from "expo-screen-orientation";
import { Audio, Video, ResizeMode } from "expo-av";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import LottieView from "lottie-react-native";

// Custom hook to manage timeouts.
function useTimeoutManager() {
  const timeoutIds = useRef<ReturnType<typeof setTimeout>[]>([]);

  const setManagedTimeout = (callback: () => void, delay: number) => {
    const id = setTimeout(callback, delay);
    timeoutIds.current.push(id);
    return id;
  };

  const clearAllTimeouts = () => {
    timeoutIds.current.forEach(clearTimeout);
    timeoutIds.current = [];
  };

  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, []);

  return { setManagedTimeout, clearAllTimeouts };
}

const ITEM_HEIGHT = 80;
const ITEM_MARGIN = 10;
const SNAP_INTERVAL = ITEM_HEIGHT + ITEM_MARGIN * 2;

let songIndex = 0;

export default function CameraScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const { setManagedTimeout, clearAllTimeouts } = useTimeoutManager();
// At the top of your component along with your other states:
const [lastDetectionImageUri, setLastDetectionImageUri] = useState<string | null>(null);

  // Ref for the camera so we can capture frames.
  // @ts-ignore
  const cameraRef = useRef<Camera>(null);

  // making an array for songs
  const songs = ["song1.mp3", "song2.mp3","song3.mp3","song4.mp3"];


  // Ref to hold the music instance.
  const soundRef = useRef<Audio.Sound | null>(null);
  // Ref to store the current playback position (in milliseconds)
  const playbackPositionRef = useRef<number>(0);

  // Ref used as a cancellation token for detection.
  const detectionCanceledRef = useRef<boolean>(false);

  const [cameraFacing, setCameraFacing] = useState<"front" | "back">("front");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [showWarning, setShowWarning] = useState<boolean>(false);
  // State for showing the number selector overlay.
  const [showNumberSelector, setShowNumberSelector] = useState<boolean>(false);
  // The selected number (number of chairs)
  const [selectedNumber, setSelectedNumber] = useState<number>(0);
  // State for game over (when chairs reach zero)
  const [gameOver, setGameOver] = useState<boolean>(false);
  // Animated values for countdown
  const fadeAnim = new Animated.Value(1);
  const scaleAnim = new Animated.Value(1);
  // State for showing the intro video.
  const [showIntroVideo, setShowIntroVideo] = useState<boolean>(true);

  // New states for chair detection.
  const [detectedChairCount, setDetectedChairCount] = useState<number | null>(null);
  const [showChairDetectionPrompt, setShowChairDetectionPrompt] = useState<boolean>(false);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [showPhoneImage, setShowPhoneImage] = useState(false);
  // New state for the sit–stand error message.
  const [showNotFilledMessage, setShowNotFilledMessage] = useState<boolean>(false);

  // Reference for the vertical ScrollView.
  const scrollViewRef = useRef<ScrollView>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const warningSoundRef = useRef<Audio.Sound | null>(null);


  // Helper: Wait for a sound to finish playing.
  const waitForSoundToFinish = (sound: Audio.Sound) => {
    return new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
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

  // Function to change the song
  const changeSong = async () => {
    songIndex = (songIndex + 1) % songs.length;
    console.log("Changed song to:", songs[songIndex]);
    if (soundRef.current) {
      soundRef.current.stopAsync();
      soundRef.current.unloadAsync();
      soundRef.current = null;
      playbackPositionRef.current = 0;
      const songPaths: { [key: string]: any } = {
        "song1.mp3": require("../../assets/song1.mp3"),
        "song2.mp3": require("../../assets/song2.mp3"),
        "song3.mp3": require("../../assets/song3.mp3"),
        "song4.mp3": require("../../assets/song4.mp3"),
        // Add other songs here
      };
      const { sound: newSound } = await Audio.Sound.createAsync(
          songPaths[songs[songIndex]],
          { shouldPlay: true }
      );
      soundRef.current = newSound;
    }
  };

  async function playSound(songname : string) {
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
        const songPaths: { [key: string]: any } = {
          "song1.mp3": require("../../assets/song1.mp3"),
          "song2.mp3": require("../../assets/song2.mp3"),
          "song3.mp3": require("../../assets/song3.mp3"),
          "song4.mp3": require("../../assets/song4.mp3"),
          // Add other songs here
        };
        const { sound: newSound } = await Audio.Sound.createAsync(
            songPaths[songname],
          { shouldPlay: true }
        );
        if (playbackPositionRef.current > 0) {
          await newSound.setStatusAsync({ positionMillis: playbackPositionRef.current });
          console.log("Restored playback position:", playbackPositionRef.current);
        }
        soundRef.current = newSound;
        console.log("Playing new music..");
      }
      // Always schedule the next random stop.
      const randomDelay = Math.floor(Math.random() * 10000) + 10000;
      console.log("Scheduling random stop in", randomDelay, "ms");
      setManagedTimeout(randomStop, randomDelay);
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
    setManagedTimeout(startSettleCountdown, 500);
  }

  function startSettleCountdown() {
    // Start concurrent sit–stand detection (2 frames/sec for 10 sec => 20 frames)
    /*
    const sitStandDetectionPromise = (async () => {
      let detectionResults: number[] = [];
      const totalFrames = 0;
      setIsDetecting(true);
      for (let i = 0; i < totalFrames; i++) {
        if (detectionCanceledRef.current) {
          console.log("Sit–stand detection canceled at frame", i);
          break;
        }
        try {
          const picture = await cameraRef.current?.takePictureAsync({
            quality: 0.5,
            base64: false,
          });
          if (picture) {
            // Save the last captured image URI for later display.
            setLastDetectionImageUri(picture.uri);

            const formData = new FormData();
            formData.append("image", {
              uri: picture.uri,
              type: "image/jpeg",
              name: "photo.jpg",
            } as any);
            // Send image to the /sitstand endpoint for sit or stand detection.
            const response = await fetch(
              "https://f754-154-80-14-143.ngrok-free.app/sitstand",
              {
                method: "POST",
                body: formData,
                headers: { "Content-Type": "multipart/form-data" },
              }
            );
            const json = await response.json();
            // Count the number of detections with status "Sitting"
            let sittingCount = 0;
            if (json.detections && Array.isArray(json.detections)) {
              json.detections.forEach((det: any) => {
                if (det.status === "Sitting") sittingCount++;
              });
            }
            detectionResults.push(sittingCount);
          }
        } catch (error) {
          console.error("Error during sit–stand detection:", error);
        }
        await new Promise((resolve) => setTimeout(resolve, 500)); // 2 frames per sec
      }
      return detectionResults;
    })();
     */

    // Clear any existing countdown interval.
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(3);
    let count = 3;
    countdownIntervalRef.current = setInterval(() => {
      count -= 1;
      console.log("Settle Countdown:", count);
      let a = 0;
      setSelectedNumber((prev) => {
        a = prev;
        return prev;
      });
      console.log("nani ka number " ,a);
      if (count === 0){
        console.log("nani bhai choti ice cream");
        (async () => {
          const picture = await cameraRef.current?.takePictureAsync({
            quality: 0.5,
            base64: false,
          });
          if (picture) {
            console.log("nani bhai ice cream");
            // Save the last captured image URI for later display.
            setLastDetectionImageUri(picture.uri);
          }

        })();
      }
      if (count < 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
        countdownIntervalRef.current = null;
        setCountdown(null);

        // Process the sit–stand detection results.
        /*
        sitStandDetectionPromise.then((results) => {
          // Tally the frequency of sitting counts.
          const frequency: { [key: number]: number } = {};
          results.forEach((num) => {
            frequency[num] = (frequency[num] || 0) + 1;
          });
          let mostFrequentSitting: number | null = null;
          let maxFreq = 0;
          for (const key in frequency) {
            if (frequency[+key] > maxFreq) {
              mostFrequentSitting = +key;
              maxFreq = frequency[+key];
            }
          }
          console.log("Most frequent sitting count:", mostFrequentSitting);
          setIsDetecting(false);

          // Deduct one chair every time the settle countdown ends.
          setSelectedNumber((prev) => {
            const newCount = prev - 1;

            // If the detected sitting count doesn't match the current number of chairs,
            // show an error message.
            console.log(newCount)
            if (mostFrequentSitting !== (newCount+1)) {
              setShowNotFilledMessage(true);
              setManagedTimeout(() => {
                setShowNotFilledMessage(false);
                if (newCount < 1) {
                  setGameOver(true);
                  if (soundRef.current) {
                    soundRef.current.stopAsync();
                  }
                  clearAllTimeouts();
                  setManagedTimeout(() => {
                    resetGame();
                  }, 5000);
                } else {


                    // Check if no chairs remain.
                  // If chairs remain, play the warning sound and resume music.
                  (async () => {
                    console.log("Playing warning sound...");
                    setShowWarning(true);
                    const { sound: warningSound } = await Audio.Sound.createAsync(
                      require("../../assets/danger.mp3"),
                      { shouldPlay: true }
                    );
                    //storing the refrence of the warning sound
                    warningSoundRef.current = warningSound;
                    await waitForSoundToFinish(warningSound);
                    await warningSound.unloadAsync();
                    setShowWarning(false);
                    if (soundRef.current) {
                      const status = await soundRef.current.getStatusAsync();
                      if ("isLoaded" in status && status.isLoaded && !status.isPlaying) {
                        await soundRef.current.playAsync();
                        console.log("Music resumed.");
                        // Schedule next random stop.
                        const randomDelay = Math.floor(Math.random() * 10000) + 10000;
                        setManagedTimeout(randomStop, randomDelay);
                      }
                    }
                  })();
                }
              }, 3000);
            }
            else {
              if (newCount < 1) {
                  setGameOver(true);
                  if (soundRef.current) {
                    soundRef.current.stopAsync();
                  }
                  clearAllTimeouts();
                  setManagedTimeout(() => {
                    resetGame();
                  }, 5000);
                } else {
                  // Check if no chairs remain.
                  // If chairs remain, play the warning sound and resume music.
                  (async () => {
                    console.log("Playing warning sound...");
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
                        // Schedule next random stop.
                        const randomDelay = Math.floor(Math.random() * 10000) + 10000;
                        setManagedTimeout(randomStop, randomDelay);
                      }
                    }
                  })();
                }
            }

            return newCount;
          });
        });
         */
        setSelectedNumber((prev) => {
          const newCount = prev - 1;
        if (newCount == 1) {
          setGameOver(true);
          if (soundRef.current) {
            soundRef.current.stopAsync();
          }
          clearAllTimeouts();
          setManagedTimeout(() => {
            resetGame();
          }, 5000);
        } else {
          (async () => {
            console.log("Playing warning sound...");
            setShowWarning(true);
            const {sound: warningSound} = await Audio.Sound.createAsync(
                require("../../assets/danger.mp3"),
                {shouldPlay: true}
            );
            //storing the refrence of the warning sound
            warningSoundRef.current = warningSound;
            await waitForSoundToFinish(warningSound);
            await warningSound.unloadAsync();
            setShowWarning(false);
            if (soundRef.current) {
              const status = await soundRef.current.getStatusAsync();
              if ("isLoaded" in status && status.isLoaded && !status.isPlaying) {
                await soundRef.current.playAsync();
                console.log("Music resumed.");
                // Schedule next random stop.
                const randomDelay = Math.floor(Math.random() * 10000) + 10000;
                setManagedTimeout(randomStop, randomDelay);
              }
            }
          })();
        }
          return newCount;
        });


      } else {
        setCountdown(count);
        animateCountdown();
      }
    }, 1000);
  }

  // Recursive animation for the countdown display.
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

  // Game countdown (5 seconds) after a number is selected.
  const startGameCountdown = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    let count = 5;
    setCountdown(count);
    countdownIntervalRef.current = setInterval(() => {
      count -= 1;
      console.log("Game Countdown:", count);
      if (count < 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
        countdownIntervalRef.current = null;
        setCountdown(null);
        //play the song .............
        playSound(songs[songIndex]);
        playbackPositionRef.current = 0;
      } else {
        setCountdown(count);
        animateCountdown();
      }
    }, 1000);
  };

  // Chair detection function (unchanged).

  // Chair detection function (unchanged).
  const startChairDetection = async () => {
    if (!cameraRef.current) {
      console.error("Camera not ready");
      return;
    }
    /*
    detectionCanceledRef.current = false;
    setIsDetecting(true);
    let detectionResults: number[] = [];
    const totalFrames = 1;
    const delayBetweenFrames = 1000 / 4; 
    for (let i = 0; i < totalFrames; i++) {
      if (detectionCanceledRef.current) {
        console.log("Chair detection canceled at frame", i);
        break;
      }
      try {
        const picture = await cameraRef.current.takePictureAsync({
          quality: 0.5,
          base64: false,
        });
        const formData = new FormData();
        formData.append("image", {
          uri: picture.uri,
          type: "image/jpeg",
          name: "photo.jpg",
        } as any);
        const response = await fetch("https://f754-154-80-14-143.ngrok-free.app/object", {
          method: "POST",
          body: formData,
          headers: { "Content-Type": "multipart/form-data" },
        });
        const json = await response.json();
        detectionResults.push(json.chair_count);
      } catch (error) {
        console.error("Error during chair detection:", error);
      }
      await new Promise((resolve) => setTimeout(resolve, delayBetweenFrames));
    }
    if (detectionCanceledRef.current) {
      setIsDetecting(false);
      return;
    }
    const frequency: { [key: number]: number } = {};
    detectionResults.forEach((count) => {
      frequency[count] = (frequency[count] || 0) + 1;
    });
    let mostFrequentCount: number | null = null;
    let maxFrequency = 0;
    for (const count in frequency) {
      if (frequency[+count] > maxFrequency) {
        mostFrequentCount = +count;
        maxFrequency = frequency[+count];
      }
    }
    setDetectedChairCount(mostFrequentCount);
     */
    setIsDetecting(false);
    //setShowChairDetectionPrompt(true);
    handleEnterManually();
  };


  // Handler for when the user clicks "Yes" on the detection prompt.
  const handleYesDetection = () => {
    if (detectedChairCount !== null) {
      setSelectedNumber(detectedChairCount);
    }
    setShowChairDetectionPrompt(false);
    startGameCountdown();
  };

  // When start/cancel button is pressed.
  const handleStartCancel = () => {
    if (isActive) {
        setShowWarning(false);
        if (warningSoundRef.current) {
            console.log("Cancelling game: stopping warning sound.");
            warningSoundRef.current.stopAsync();
            warningSoundRef.current.unloadAsync();
            warningSoundRef.current = null;
        }

      if (isDetecting) {
        detectionCanceledRef.current = true;
        setIsDetecting(false);
      }
      setCountdown(null);
      if (soundRef.current) {
        console.log("Cancelling game: stopping and unloading music.");
        soundRef.current.stopAsync();
        soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      setIsActive(false);
      setShowNumberSelector(false);
      clearAllTimeouts();
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }

      // Reset the selected number and game over state.
        setCountdown(null);
        setGameOver(false);
        setSelectedNumber(0);

    } else {
      setIsActive(true);
      startChairDetection();
    }
  };

  // Handlers for the chair detection prompt.
  const handleEnterManually = () => {
    if (detectedChairCount !== null) {
      setSelectedNumber(detectedChairCount);
    }
    setShowChairDetectionPrompt(false);
    setShowNumberSelector(true);
  };

  const handleRetryDetection = () => {
    setShowChairDetectionPrompt(false);
    startChairDetection();
  };

  const toggleCamera = () => {
    setCameraFacing((prev) => (prev === "back" ? "front" : "back"));
  };

  const resetGame = () => {
    setIsActive(false);
    setShowNumberSelector(false);
    setCountdown(null);
    setGameOver(false);
    setSelectedNumber(0);
    clearAllTimeouts();
    setLastDetectionImageUri(null);
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
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        router.replace("/");
      };
    }, [])
  );

  // Back button handler.
  const handleBack = async () => {
    console.log("Back button pressed. Cleaning up resources...");
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    playbackPositionRef.current = 0;
    clearAllTimeouts();
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsActive(false);
    setShowNumberSelector(false);
    setCountdown(null);
    setGameOver(false);
    setSelectedNumber(0);
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    router.replace("/");
  };

  if (showIntroVideo) {
    return (
        <View style={styles.videoContainer}>
          <Video
              source={require("../../assets/intro.mp4")}
              style={styles.video}
              shouldPlay
              resizeMode={ResizeMode.COVER}
              onPlaybackStatusUpdate={(status) => {
                if (status.isLoaded && status.didJustFinish) {
                  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
                  setShowIntroVideo(false);
                  setShowPhoneImage(true);

                  // Hide the image after 3 seconds
                  setTimeout(() => {
                    setShowPhoneImage(false);
                  }, 3000);
                }
              }}
          />
        </View>
    );
  }

  if (showPhoneImage) {
    return (
        <View style={styles.imageContainer}>
          <Image
              source={require("../../assets/put_phone.jpg")}
              style={styles.fullscreenImage}
              resizeMode="contain"
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
      {/* Camera view */}
      <CameraView
        ref={cameraRef}
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

      {/* Warning Overlay */}
      {showWarning && (
        <View style={styles.warningContainer}>
          <Text style={styles.warningText}>GAME IS RESUMING</Text>
        </View>
      )}

      {/* Game Over Overlay */}
      {gameOver && (
  <View style={styles.gameOverOverlay}>
    {lastDetectionImageUri && (
      <Image source={{ uri: lastDetectionImageUri }} style={styles.gameOverImage} />
    )}
    <Text style={styles.gameOverText}>Congratulations Winner</Text>
  </View>
)}


      {/* Start/Cancel Button */}
      <TouchableOpacity
        style={[styles.startButton, isActive ? { backgroundColor: "rgba(255, 0, 0, 0.3)" } : {}]}
        onPress={handleStartCancel}
      >
        <Image source={isActive ? require("../../assets/close.png") : require("../../assets/play.png")} style={styles.startIcon} />
      </TouchableOpacity>

      {/* Camera Toggle Button */}
      <TouchableOpacity style={styles.toggleButton} onPress={toggleCamera}>
        <Image source={require("../../assets/switch-camera.png")} style={styles.switchIcon} />
      </TouchableOpacity>

      {/* song Toggle Button */}
      <TouchableOpacity style={styles.songtoggleButton} onPress={changeSong}>
        <Image source={require("../../assets/playlist.png")} style={styles.songswitchicon} />
      </TouchableOpacity>


      {/* Number Selector Overlay */}
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
              setSelectedNumber(index + 3);
            }}
          >
            {Array.from({ length: 10 }).map((_, index) => {
              const number = index + 3;
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
                    <Image source={require("../../assets/user.png")} style={styles.chairIcon} />
                    <Text style={[styles.numberText, isSelected && styles.selectedNumberText]}>
                      {number}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <Image source={require("../../assets/down-arrow.png")} style={styles.downArrowIcon} />
        </View>
      )}

      {/* Display selected number with chair icon */}
      {isActive && !showNumberSelector && (
        <View style={styles.selectedNumberDisplay}>
          <Image source={require("../../assets/chair.png")} style={styles.chairIcon} />
          <Text style={styles.selectedNumberText}>{selectedNumber}</Text>
        </View>
      )}

      {/* While detection is running, show overlay text */}
      {isDetecting && (
        <View style={styles.detectionOverlay}>
            <LottieView
            source={require("../../assets/loading.json")}
            autoPlay
            loop
            style={styles.lottie}
            />
          <Text style={styles.detectionText}>Chairs are being Detected</Text>
        </View>
      )}

      {/* Overlay message if sitting count doesn't match chairs */}
      {showNotFilledMessage && (
        <View style={styles.notFilledOverlay}>
          <Text style={styles.notFilledText}>All chairs are not filled</Text>
        </View>
      )}


      {/* Chair Detection Prompt Modal */}
      <Modal
        transparent
        visible={showChairDetectionPrompt && !isDetecting}
        animationType="fade"
        onRequestClose={() => setShowChairDetectionPrompt(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalText}>
              Detected {detectedChairCount} chair{detectedChairCount === 1 ? "" : "s"}.
            </Text>
            <Text style={styles.modalText}>
              Is this the correct number of chairs?
            </Text>
            <View style={styles.modalButtonContainer}>
              <TouchableOpacity style={styles.modalButton} onPress={handleEnterManually}>
                <Text style={styles.modalButtonText}>Enter Manually</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButton} onPress={handleYesDetection}>
                <Text style={styles.modalButtonText}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButton} onPress={handleRetryDetection}>
                <Text style={styles.modalButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  imageContainer: {
    flex: 1,
    backgroundColor: "black",
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenImage: {
    width: "100%",
    height: "80%",
  },
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
  countdownText: { fontSize: 120, fontWeight: "bold", color: "rgba(255,255,255,0.8)", justifyContent: "center" },
  warningContainer: {
    position: "absolute",
    top: "50%",
    left: "30%",
    transform: [{ translateX: -50 }, { translateY: -50 }],
    backgroundColor: "rgba(191, 0, 0, 0.5)",
    padding: 20,
    borderRadius: 30,
  },
  gameOverImage: {
    width: "80%",
    height: "50%",
    resizeMode: "contain",
    marginBottom: 20, // optional, for spacing between image and text
  },
  warningText: {
    color: "#fff",
    fontSize: 40,
    fontWeight: "bold",
    textAlign: "center",
    textShadowColor: "#ff0000",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  startIcon: { width: 40, height: 40, resizeMode: "contain" },
  numberSelectorContainer: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: ITEM_HEIGHT + ITEM_MARGIN * 2 - 20, // Reduced width
    height: "50%",
    transform: [{ translateX: -(ITEM_HEIGHT + ITEM_MARGIN * 2 - 20) / 2 }, { translateY: -100 }], // Adjusted translation
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
  numberItem: {
    height: ITEM_HEIGHT,
    marginVertical: ITEM_MARGIN,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 10,
  },
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
  chairIcon: { width: 30, height: 30, marginRight: 8 },
  selectedNumberText: { fontSize: 24, color: "black", fontWeight: "bold" },
  downArrowIcon: { width: 30, height: 30, alignSelf: "center", marginTop: 10, tintColor: "white" },
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
  gameOverText: { fontSize: 32, color: "white", fontWeight: "bold" },
  detectionOverlay: {
    position: "absolute",
    top: "10%",
    left: 140,
    right: 140,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingVertical: 10,
  },
  detectionText: { fontSize: 20, color: "white", fontWeight: "bold", justifyContent: "center" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.43)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: "80%",
    backgroundColor: "#333",
    padding: 20,
    borderRadius: 10,
    alignItems: "center",
  },
  modalText: { fontSize: 18, color: "white", marginVertical: 10, textAlign: "center" },
  modalButtonContainer: { flexDirection: "row", marginTop: 15, borderRadius: 400, opacity: 0.5, justifyContent: "center" },
  modalButton: {
    backgroundColor: "#555",
    paddingVertical: 10,
    paddingHorizontal: 15,
    marginHorizontal: 10,
    borderRadius: 10,
  },
  modalButtonText: { color: "white", fontSize: 16 },
  notFilledOverlay: {
    position: "absolute",
    top: "10%",
    left: 140,
    right: 140,
    alignItems: "center",
    backgroundColor: "rgba(200, 0, 0, 0.65)",
    paddingVertical: 10,
    borderRadius: 20,
  },
  notFilledText: {
    fontSize: 20,
    color: "white",
    fontWeight: "bold",
  },
  lottie: {
    width: 100,
    height: 100,
    position: "absolute",
    top: "-80%", // adjust as needed
    right: "42%", // adjust as needed
    opacity: 0.7,
  },
  songtoggleButton: {
  position: "absolute",
  top: 50,
  right: 40,
  backgroundColor: "rgba(255,255,255,0.66)",
  padding: 15,
  borderRadius: 30,
  borderWidth: 2,
  borderColor: "white",
  justifyContent: "center",
  alignItems: "center",
  width: 80,
  height: 80,
  },
  songswitchicon: { width: 40, height: 40, resizeMode: "contain" }
});
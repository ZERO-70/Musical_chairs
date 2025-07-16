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
import { loadYoloModel,runLocalInference, visualizeTensorAsASCII, imageToTensor, DetectionResult, convertToPixelCoords, detectWinner, WinnerDetectionResult } from '@/modelLoader';
import * as ort from 'onnxruntime-react-native';

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
// Global variable to store the previous number of chairs for game restart
let previousChairCount = 0;

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

  // New states for person detection to determine chair count.
  const [detectedPersonCount, setDetectedPersonCount] = useState<number | null>(null);
  const [showPersonDetectionPrompt, setShowPersonDetectionPrompt] = useState<boolean>(false);
  const [detectionVisualization, setDetectionVisualization] = useState<string | null>(null);
  const [showDetectionVisualization, setShowDetectionVisualization] = useState<boolean>(false);
  const [detectionBboxes, setDetectionBboxes] = useState<DetectionResult['detections']>([]);
  const [imageSize, setImageSize] = useState<{width: number, height: number}>({width: 300, height: 200});
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  // New state for the sit–stand error message.
  const [showNotFilledMessage, setShowNotFilledMessage] = useState<boolean>(false);
  // New state for game over countdown
  const [gameOverCountdown, setGameOverCountdown] = useState<number | null>(null);
  // New state for not enough players error
  const [showNotEnoughPlayersError, setShowNotEnoughPlayersError] = useState<boolean>(false);
  // New state for winner detection
  const [winnerDetectionResult, setWinnerDetectionResult] = useState<WinnerDetectionResult | null>(null);
  const [isDetectingWinner, setIsDetectingWinner] = useState<boolean>(false);

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

  // In App.tsx or a relevant component
  const [modelSession, setModelSession] = useState<ort.InferenceSession | null>(null);

  useEffect(() => {
    async function initModel() {
      const session = await loadYoloModel();
      if (session) {
        setModelSession(session);
      }
    }
    initModel();
  }, []);


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
    /*const sitStandDetectionPromise = (async () => {
      let detectionResults: number[] = [];
      const totalFrames = 3;
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
              "https://a93e-124-29-253-131.ngrok-free.app/sitstand",
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
    })();*/

    // Clear any existing countdown interval.
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(10);
    let count = 10;
    countdownIntervalRef.current = setInterval(() => {
      count -= 1;
      console.log("Settle Countdown:", count);
      if (count < 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
        countdownIntervalRef.current = null;
        setCountdown(null);

        // Process the sit–stand detection results.
        
        /*sitStandDetectionPromise.then((results) => {
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
            */
          let mostFrequentSitting = 0;

          console.log("Most frequent sitting count:", mostFrequentSitting);
          setIsDetecting(false);

          // Deduct one chair every time the settle countdown ends.
          setSelectedNumber((prev) => {
            const newCount = prev - 1;

            // If the detected sitting count doesn't match the current number of chairs,
            // show an error message.
            console.log(newCount)
            if (false && mostFrequentSitting !== (newCount+1)) {
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
                    startGameOverCountdown();
                  }, 3000); // Wait 3 seconds to show "Congratulations Winner" before starting countdown
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
                  // Game is over, detect the winner before showing congratulations
                  setGameOver(true);
                  if (soundRef.current) {
                    soundRef.current.stopAsync();
                  }
                  clearAllTimeouts();
                  
                  // Start winner detection process
                  setManagedTimeout(async () => {
                    await detectGameWinner();
                  }, 1000); // Wait 1 second after music stops to capture frame
                } else if (newCount === 1) {
                  // Only 1 chair remaining - this is the final round!
                  console.log("🏆 Final round! Only 1 chair remaining.");
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
        /*});*/
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

  // Function to start the game over countdown (10 seconds) before restarting
  const startGameOverCountdown = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    let count = 10;
    setGameOverCountdown(count);
    countdownIntervalRef.current = setInterval(() => {
      count -= 1;
      console.log("Game Over Restart Countdown:", count);
      if (count < 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
        countdownIntervalRef.current = null;
        setGameOverCountdown(null);
        // Restart the game with the previous chair count
        restartGameWithSameChairs();
      } else {
        setGameOverCountdown(count);
        animateCountdown();
      }
    }, 1000);
  };

  // Function to restart the game with the same number of chairs
  const restartGameWithSameChairs = () => {
    setGameOver(false);
    setSelectedNumber(previousChairCount);
    setIsActive(true);
    startGameCountdown();
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

  // Function to detect the winner when the game ends
  const detectGameWinner = async () => {
    if (!cameraRef.current || !modelSession) {
      console.error("Camera or model not ready for winner detection");
      setManagedTimeout(() => {
        startGameOverCountdown();
      }, 3000);
      return;
    }

    console.log("🏆 Starting winner detection process...");
    setIsDetectingWinner(true);

    try {
      // Run winner detection (handles image capture internally)
      const winnerResult = await detectWinner(
        modelSession,
        cameraRef,
        3 // Max 3 retries
      );

      console.log(`🏆 Winner detection result:`, winnerResult);
      setWinnerDetectionResult(winnerResult);
      setIsDetectingWinner(false);

      // Show results for 5 seconds before starting countdown
      setManagedTimeout(() => {
        startGameOverCountdown();
      }, 5000);

    } catch (error) {
      console.error("Error during winner detection:", error);
      setIsDetectingWinner(false);
      
      // Fallback: show generic game over after 3 seconds
      setManagedTimeout(() => {
        startGameOverCountdown();
      }, 3000);
    }
  };

  // Person detection function to count players for musical chairs game.
  const startPersonDetection = async () => {
    if (!cameraRef.current) {
      console.error("Camera not ready");
      return;
    }
    detectionCanceledRef.current = false;
    setIsDetecting(true);
    let detectionResults: number[] = [];
    let lastDetectionResult: DetectionResult | null = null;
    let lastPictureUri: string | null = null;
    const totalFrames = 1; // You can adjust this if you want to sample more frames.
    const delayBetweenFrames = 1000 / 4; // 250ms between frames

    // Assume that you already have a loaded model session stored in a variable or state.
    // For example, you might have loaded it earlier and stored it as `modelSession`.
    if (!modelSession) {
      console.error("Model session not loaded");
      setIsDetecting(false);
      return;
    }

    for (let i = 0; i < totalFrames; i++) {
      if (detectionCanceledRef.current) {
        console.log("Chair detection canceled at frame", i);
        break;
      }
      try {
        // Capture a picture from the camera.
        const picture = await cameraRef.current.takePictureAsync({
          quality: 0.5,
          base64: false,
        });

        // Instead of sending the image to a server, run local inference.
        const detectionResult = await runLocalInference(modelSession, picture.uri);
        const personCount = detectionResult.personCount;
        
        // Store the last detection result and image for visualization
        lastDetectionResult = detectionResult;
        lastPictureUri = picture.uri;
        
        console.log(`🎯 Detection result: ${detectionResult.personCount} persons, ${detectionResult.detections.length} bounding boxes`);
        
        // 🔍 OPTIONAL: Add visual tensor validation (uncomment to debug)
        // console.log("🎨 Visualizing tensor content as ASCII:");
        // const inputTensor = await imageToTensor(picture.uri);
        // visualizeTensorAsASCII(inputTensor, 20);
        
        detectionResults.push(personCount);
        console.log(`Frame ${i} detected ${personCount} persons`);
      } catch (error) {
        console.error("Error during chair detection:", error);
      }
      // Wait a bit before processing the next frame.
      await new Promise((resolve) => setTimeout(resolve, delayBetweenFrames));
    }

    if (detectionCanceledRef.current) {
      setIsDetecting(false);
      return;
    }

    // Aggregate the results (find the most frequently detected chair count).
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
    setDetectedPersonCount(mostFrequentCount);
    setIsDetecting(false);
    
    // Set the visualization image and bounding boxes
    if (lastPictureUri && lastDetectionResult) {
      setDetectionVisualization(lastPictureUri);
      setDetectionBboxes(lastDetectionResult.detections);
    }
    
    setShowPersonDetectionPrompt(true);
  };



  // Handler for when the user clicks "Yes" on the detection prompt.
  const handleYesDetection = () => {
    if (detectedPersonCount !== null) {
      // Check if there are enough players (at least 2)
      if (detectedPersonCount < 2) {
        setShowPersonDetectionPrompt(false);
        setShowNotEnoughPlayersError(true);
        // Show error for 3 seconds then reset
        setTimeout(() => {
          setShowNotEnoughPlayersError(false);
          resetGame();
        }, 3000);
        return;
      }
      
      // In musical chairs, you need 1 less chair than people
      const chairCount = Math.max(0, detectedPersonCount - 1);
      setSelectedNumber(chairCount);
      // Store the chair count for future game restarts
      previousChairCount = chairCount;
    }
    setShowPersonDetectionPrompt(false);
    
    // Show visualization for 3 seconds
    if (detectionVisualization) {
      setShowDetectionVisualization(true);
      setTimeout(() => {
        setShowDetectionVisualization(false);
      }, 3000);
    }
    
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
        setGameOverCountdown(null);
        setShowNotEnoughPlayersError(false);
        setSelectedNumber(0);
        setWinnerDetectionResult(null);
        setIsDetectingWinner(false);
        setLastDetectionImageUri(null);

    } else {
      setIsActive(true);
      startPersonDetection();
    }
  };

  // Handlers for the person detection prompt.
  const handleEnterManually = () => {
    if (detectedPersonCount !== null) {
      setSelectedNumber(detectedPersonCount);
      // Store the chair count for future game restarts
      previousChairCount = detectedPersonCount;
    }
    setShowPersonDetectionPrompt(false);
    
    // Show visualization for 3 seconds
    if (detectionVisualization) {
      setShowDetectionVisualization(true);
      setTimeout(() => {
        setShowDetectionVisualization(false);
      }, 3000);
    }
    
    setShowNumberSelector(true);
  };

  const handleRetryDetection = () => {
    setShowPersonDetectionPrompt(false);
    startPersonDetection();
  };

  const toggleCamera = () => {
    setCameraFacing((prev) => (prev === "back" ? "front" : "back"));
  };

  const resetGame = () => {
    setIsActive(false);
    setShowNumberSelector(false);
    setCountdown(null);
    setGameOver(false);
    setGameOverCountdown(null);
    setShowNotEnoughPlayersError(false);
    setSelectedNumber(0);
    setWinnerDetectionResult(null);
    setIsDetectingWinner(false);
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

      {/* Game Over Countdown Display */}
      {gameOverCountdown !== null && (
        <View style={styles.gameOverCountdownContainer}>
          <Text style={styles.gameOverCountdownLabel}>Game Restarting In:</Text>
          <Animated.Text style={[styles.gameOverCountdownText, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
            {gameOverCountdown}
          </Animated.Text>
        </View>
      )}

      {/* Warning Overlay */}
      {showWarning && (
        <View style={styles.warningContainer}>
          <Text style={styles.warningText}>GAME IS RESUMING</Text>
        </View>
      )}

      {/* Not Enough Players Error Overlay */}
      {showNotEnoughPlayersError && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>NOT ENOUGH PLAYERS</Text>
        </View>
      )}

      {/* Game Over Overlay */}
      {gameOver && (
  <View style={styles.gameOverOverlay}>
    {isDetectingWinner && (
      <View style={styles.winnerDetectionContainer}>
        <LottieView
          source={require("../../assets/loading.json")}
          autoPlay
          loop
          style={styles.winnerDetectionLottie}
        />
        <Text style={styles.winnerDetectionText}>Detecting Winner...</Text>
      </View>
    )}
    {!isDetectingWinner && winnerDetectionResult && (
      <>
        {winnerDetectionResult.success && winnerDetectionResult.winnerImage ? (
          <View style={styles.winnerImageContainer}>
            <Image 
              source={{ uri: winnerDetectionResult.winnerImage }} 
              style={styles.winnerImage}
              onLoad={(event) => {
                const { width, height } = event.nativeEvent.source;
                setImageSize({ width: 300, height: (height * 300) / width });
              }}
            />
            {winnerDetectionResult.winnerBbox && (
              (() => {
                const pixelCoords = convertToPixelCoords(
                  winnerDetectionResult.winnerBbox, 
                  imageSize.width, 
                  imageSize.height
                );
                return (
                  <View
                    style={[
                      styles.winnerBoundingBox,
                      {
                        left: pixelCoords.x1,
                        top: pixelCoords.y1,
                        width: pixelCoords.x2 - pixelCoords.x1,
                        height: pixelCoords.y2 - pixelCoords.y1,
                      }
                    ]}
                  >
                    <Text style={styles.winnerLabel}>🏆 WINNER!</Text>
                  </View>
                );
              })()
            )}
          </View>
        ) : (
          winnerDetectionResult.fullImage && (
            <Image source={{ uri: winnerDetectionResult.fullImage }} style={styles.gameOverImage} />
          )
        )}
        <Text style={styles.gameOverText}>
          {winnerDetectionResult.success ? "🏆 Congratulations Winner!" : "Congratulations Winner!"}
        </Text>
        {winnerDetectionResult.success && winnerDetectionResult.confidence && (
          <Text style={styles.winnerConfidenceText}>
            Detected with {(winnerDetectionResult.confidence * 100).toFixed(0)}% confidence
          </Text>
        )}
      </>
    )}
    {!isDetectingWinner && !winnerDetectionResult && lastDetectionImageUri && (
      <>
        <Image source={{ uri: lastDetectionImageUri }} style={styles.gameOverImage} />
        <Text style={styles.gameOverText}>Congratulations Winner</Text>
      </>
    )}
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
              const selectedNum = index + 1;
              setSelectedNumber(selectedNum);
              // Store the chair count for future game restarts
              previousChairCount = selectedNum;
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
                    // Store the chair count for future game restarts
                    previousChairCount = number;
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
        visible={showPersonDetectionPrompt && !isDetecting}
        animationType="fade"
        onRequestClose={() => setShowPersonDetectionPrompt(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalText}>
              Detected {detectedPersonCount} person{detectedPersonCount === 1 ? "" : "s"} playing.
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

      {/* Detection Visualization Modal */}
      <Modal
        transparent
        visible={showDetectionVisualization}
        animationType="fade"
        onRequestClose={() => setShowDetectionVisualization(false)}
      >
        <View style={styles.visualizationOverlay}>
          <View style={styles.visualizationContainer}>
            <Text style={styles.visualizationTitle}>Person Detection Results</Text>
            {detectionVisualization && (
              <View style={styles.imageContainer}>
                <Image 
                  source={{ uri: detectionVisualization }} 
                  style={styles.visualizationImage}
                  resizeMode="contain"
                  onLoad={(event) => {
                    const { width, height } = event.nativeEvent.source;
                    setImageSize({ width: 300, height: (height * 300) / width });
                  }}
                />
                {/* Render bounding boxes as overlays */}
                {detectionBboxes.map((detection, index) => {
                  const pixelCoords = convertToPixelCoords(detection.bbox, imageSize.width, imageSize.height);
                  return (
                    <View
                      key={index}
                      style={[
                        styles.boundingBox,
                        {
                          left: pixelCoords.x1,
                          top: pixelCoords.y1,
                          width: pixelCoords.x2 - pixelCoords.x1,
                          height: pixelCoords.y2 - pixelCoords.y1,
                        }
                      ]}
                    >
                      <Text style={styles.confidenceText}>
                        {(detection.confidence * 100).toFixed(0)}%
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
            <Text style={styles.visualizationText}>
              🎯 {detectedPersonCount} person{detectedPersonCount !== 1 ? 's' : ''} detected
            </Text>
            <Text style={styles.visualizationSubtext}>
              Image will close automatically in 3 seconds...
            </Text>
            <TouchableOpacity 
              style={styles.closeButton} 
              onPress={() => setShowDetectionVisualization(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  countdownText: { fontSize: 120, fontWeight: "bold", color: "rgba(255,255,255,0.8)", justifyContent: "center" },
  gameOverCountdownContainer: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: [{ translateX: -150 }, { translateY: -75 }],
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    padding: 20,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: "rgba(255, 215, 0, 0.8)",
    width: 300,
    height: 150,
    justifyContent: "center",
  },
  gameOverCountdownLabel: {
    fontSize: 24,
    fontWeight: "bold",
    color: "rgba(255, 215, 0, 1)",
    marginBottom: 10,
    textAlign: "center",
  },
  gameOverCountdownText: {
    fontSize: 80,
    fontWeight: "bold",
    color: "rgba(255, 255, 255, 0.9)",
    textAlign: "center",
  },
  warningContainer: {
    position: "absolute",
    top: "50%",
    left: "30%",
    transform: [{ translateX: -50 }, { translateY: -50 }],
    backgroundColor: "rgba(191, 0, 0, 0.5)",
    padding: 20,
    borderRadius: 30,
  },
  errorContainer: {
    position: "absolute",
    top: "50%",
    left: "30%",
    transform: [{ translateX: -50 }, { translateY: -50 }],
    backgroundColor: "rgba(255, 69, 0, 0.5)",
    padding: 20,
    borderRadius: 30,
  },
  errorText: {
    color: "#fff",
    fontSize: 40,
    fontWeight: "bold",
    textAlign: "center",
    textShadowColor: "#ff4500",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  gameOverImage: {
    width: "80%",
    height: "50%",
    resizeMode: "contain",
    marginBottom: 20, // optional, for spacing between image and text
  },
  winnerImage: {
    width: 300,
    height: 200,
    resizeMode: "contain",
    marginBottom: 20,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: "#FFD700", // Gold border for winner
  },
  winnerDetectionContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  winnerDetectionLottie: {
    width: 150,
    height: 150,
  },
  winnerDetectionText: {
    fontSize: 24,
    color: "#FFD700",
    fontWeight: "bold",
    marginTop: 10,
    textAlign: "center",
  },
  winnerConfidenceText: {
    fontSize: 16,
    color: "#ccc",
    fontStyle: "italic",
    marginTop: 10,
    textAlign: "center",
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
    top: "-80%" // adjust as needed
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
  songswitchicon: { width: 40, height: 40, resizeMode: "contain" },
  
  // Detection visualization styles
  visualizationOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  visualizationContainer: {
    backgroundColor: "rgba(40,40,40,0.95)",
    borderRadius: 20,
    padding: 20,
    margin: 20,
    alignItems: "center",
    maxWidth: "90%",
    maxHeight: "80%",
  },
  visualizationTitle: {
    fontSize: 20,
    color: "white",
    fontWeight: "bold",
    marginBottom: 15,
    textAlign: "center",
  },
  imageContainer: {
    position: "relative",
    marginBottom: 15,
  },
  visualizationImage: {
    width: 300,
    height: 200,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#4CAF50",
  },
  boundingBox: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#ff0000",
    backgroundColor: "transparent",
  },
  confidenceText: {
    position: "absolute",
    top: -20,
    left: 0,
    backgroundColor: "#ff0000",
    color: "white",
    fontSize: 10,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
  },
  visualizationText: {
    fontSize: 18,
    color: "#4CAF50",
    fontWeight: "bold",
    marginBottom: 5,
    textAlign: "center",
  },
  visualizationSubtext: {
    fontSize: 14,
    color: "#ccc",
    marginBottom: 15,
    textAlign: "center",
  },
  closeButton: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  closeButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  winnerImageContainer: {
    position: "relative",
    width: 300,
    height: 200,
    marginBottom: 20,
  },
  winnerBoundingBox: {
    position: "absolute",
    borderWidth: 3,
    borderColor: "#00FF00", // Green bounding box
    backgroundColor: "transparent",
    justifyContent: "flex-start",
    alignItems: "flex-start",
  },
  winnerLabel: {
    backgroundColor: "#00FF00",
    color: "#000",
    fontSize: 12,
    fontWeight: "bold",
    padding: 4,
    borderRadius: 4,
    position: "absolute",
    top: -25,
    left: 0,
  },
});
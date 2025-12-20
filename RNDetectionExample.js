// RNDetectionExample.js
// React Native example using a TFLite SSD MobileNet v2 model for on-device detection.
// NOTE: coco-ssd (TFJS) is browser/WebView only. For RN use TFLite models.

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import Tflite from 'tflite-react-native';

const tflite = new Tflite();

export default function RNDetectionExample() {
  const [status, setStatus] = useState('Loading model...');

  useEffect(() => {
    tflite.loadModel(
      {
        // Place the model in android/app/src/main/assets or iOS bundle.
        model: 'ssd_mobilenet_v2.tflite',
        // Optional labels file if your model provides it.
        labels: 'coco_labels.txt',
      },
      (err, res) => {
        if (err) {
          setStatus(`Model load error: ${err}`);
          return;
        }
        setStatus('Model ready');
      }
    );
  }, []);

  async function runInferenceOnFrame(frame) {
    // frame should be a preprocessed image buffer.
    // For camera frames, convert to RGB bytes and resize to model input size (e.g., 300x300).
    // Use react-native-camera or react-native-vision-camera frame processors to convert frames.
    tflite.detectObjectOnImage(
      {
        path: frame.path, // or use image data buffer
        imageMean: 127.5,
        imageStd: 127.5,
        threshold: 0.4,
        numResultsPerClass: 5,
      },
      (err, res) => {
        if (err) {
          console.warn('Inference error', err);
          return;
        }
        // res includes bounding boxes, class names, and confidence scores.
        console.log('Detections', res);
      }
    );
  }

  return (
    <View>
      <Text>{status}</Text>
      {/* Hook this up to a camera component and call runInferenceOnFrame(frame) */}
    </View>
  );
}

// To obtain SSD MobileNet v2 TFLite:
// - Download from TensorFlow Model Zoo or TFHub: "ssd_mobilenet_v2" (TFLite).
// - Ensure you use a detection model compatible with TFLite and COCO labels.

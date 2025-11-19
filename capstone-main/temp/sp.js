/*
document.addEventListener("DOMContentLoaded", function() {
    const imageInput = document.getElementById("imageInput");
    const selectedImage = document.getElementById("selectedImage");
    const recognizeButton = document.getElementById("recognizeButton");
    const result = document.getElementById("result");

    imageInput.addEventListener("change", function() {
        const file = imageInput.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                selectedImage.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    recognizeButton.addEventListener("click", function() {
        // Perform image recognition here using an appropriate API or library.
        // Update the 'result' element with the recognition result.
        result.textContent = "Recognition result will be displayed here.";
    });
});
*/

document.addEventListener("DOMContentLoaded", function () 
{
    const menuIcon = document.querySelector(".menu-icon");
    const navLinks = document.querySelector(".nav-links");

    menuIcon.addEventListener("click", function () {
        navLinks.classList.toggle("active");
    });
});

document.addEventListener("DOMContentLoaded", function() {
    const imageInput = document.getElementById("imageInput");
    const selectedImage = document.getElementById("selectedImage");
    const recognizeButton = document.getElementById("recognizeButton");
    const result = document.getElementById("result");
    const captureButton = document.getElementById("captureButton"); // New Capture Button

    // Function to handle capturing an image from the camera
    function captureImageFromCamera() {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            imageInput.style.display = "none"; // Hide the file input
            capturedImage.style.display = "block"; // Show the captured image

            navigator.mediaDevices.getUserMedia({ video: true })
                .then(function(stream) {
                    selectedImage.style.display = "none"; // Hide the selected image
                    capturedImage.srcObject = stream;
                    
                    // Capture a photo when the stream is ready
                    const track = stream.getVideoTracks()[0];
                    const imageCapture = new ImageCapture(track);
                    return imageCapture.takePhoto();
                })
                .then(function(photoBlob) 
                {
                    return URL.createObjectURL(photoBlob);
                })
                .then(function(photoURL) 
                {
                    capturedImage.src = photoURL;
                })
                .catch(function(error) 
                {
                    console.error("Error accessing the camera: " + error);
                });
        } else {
            console.error("getUserMedia not supported by this browser.");
        }
    }


    captureButton.addEventListener("click", captureImageFromCamera); // Attach click event to the capture button

    imageInput.addEventListener("change", function() {
        const file = imageInput.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                selectedImage.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    /*recognizeButton.addEventListener("click", function() {
        // Perform image recognition here using an appropriate API or library.
        // Update the 'result' element with the recognition result.
        result.textContent = "Loading recognition result..";
    });*/
    recognizeButton.addEventListener("click", function() {
        // Perform image recognition here using an appropriate API or library.
        // Update the 'result' element with the recognition result.

        // Simulate an error for demonstration purposes
        const simulateError = Math.random() < 0.5; // Simulate an error 50% of the time
        if (simulateError) {
            result.textContent = "Error: Image recognition failed.";
        } else {
            result.textContent = "Disease detected: Example Disease";
        }
    });

});


/**refresss button */
document.addEventListener("DOMContentLoaded", function() {
    const refreshButton = document.getElementById("refreshImage");
    const selectedImage = document.getElementById("selectedImage");
    const imageInput = document.getElementById("imageInput");

    refreshButton.addEventListener("click", function() {
        // Clear the selected image by setting its source to an empty string
        selectedImage.src = "";

        // Reset the file input by clearing its value
        imageInput.value = "";
    });

    // Function to handle file input change
    imageInput.addEventListener("change", function() {
        const file = imageInput.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                selectedImage.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
});




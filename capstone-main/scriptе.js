

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
    const captureButton = document.getElementById("captureButton"); 

   
    function captureImageFromCamera() {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            imageInput.style.display = "none"; 
            capturedImage.style.display = "block"; 

            navigator.mediaDevices.getUserMedia({ video: true })
                .then(function(stream) {
                    selectedImage.style.display = "none"; 
                    capturedImage.srcObject = stream;
                    
                   
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


    captureButton.addEventListener("click", captureImageFromCamera); 

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
     
        const simulateError = Math.random() < 0.5; 
        if (simulateError) {
            result.textContent = "Error: Image recognition failed.";
        } else {
            result.textContent = "Disease detected: Example Disease";
        }
    });

});



document.addEventListener("DOMContentLoaded", function() {
    const refreshButton = document.getElementById("refreshImage");
    const selectedImage = document.getElementById("selectedImage");
    const imageInput = document.getElementById("imageInput");

    refreshButton.addEventListener("click", function() {
        
        selectedImage.src = "";

        
        imageInput.value = "";
    });

    
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



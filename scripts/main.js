/**
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

// Initializes Health Journal.
function HealthJournal() {
  this.checkSetup();

  this.isDoctor = false;

  // Shortcuts to DOM Elements.
  this.messageList = document.getElementById('messages');
  this.messageListForDoctors = document.getElementById('messages-for-doctors');
  this.messageForm = document.getElementById('message-form');
  this.messageInput = document.getElementById('message');
  this.categoryInput = document.getElementById('category');
  this.submitButton = document.getElementById('submit');
  this.submitImageButton = document.getElementById('submitImage');
  this.imageForm = document.getElementById('image-form');
  this.filterForm = document.getElementById('filter-form');
  this.filterInput = document.getElementById('filter');
  this.mediaCapture = document.getElementById('mediaCapture');
  this.userPic = document.getElementById('user-pic');
  this.userName = document.getElementById('user-name');
  this.signInButton = document.getElementById('sign-in');
  this.signOutButton = document.getElementById('sign-out');
  this.signInSnackbar = document.getElementById('must-signin-snackbar');

  // Saves message on form submit.
  this.messageForm.addEventListener('submit', this.saveMessage.bind(this));
  this.signOutButton.addEventListener('click', this.signOut.bind(this));
  this.signInButton.addEventListener('click', this.signIn.bind(this));

  // Toggle for the button.
  var buttonTogglingHandler = this.toggleButton.bind(this);
  this.messageInput.addEventListener('keyup', buttonTogglingHandler);
  this.messageInput.addEventListener('change', buttonTogglingHandler);

  // Event filter change
  this.filterInput.addEventListener('change', this.filterMessage.bind(this));

  // Events for image upload.
  this.submitImageButton.addEventListener('click', function(e) {
    e.preventDefault();
    this.mediaCapture.click();
  }.bind(this));
  this.mediaCapture.addEventListener('change', this.saveImageMessage.bind(this));

  this.initFirebase();
}

// Sets up shortcuts to Firebase features and initiate firebase auth.
HealthJournal.prototype.initFirebase = function() {
  // Shortcuts to Firebase SDK features.
  this.auth = firebase.auth();
  this.database = firebase.database();
  this.storage = firebase.storage();
  // Initiates Firebase auth and listen to auth state changes.
  this.auth.onAuthStateChanged(this.onAuthStateChanged.bind(this));
};

// Checks the user permissions and then redirect to correct view
HealthJournal.prototype.checkPermissions = function() {
    var _this = this;

    // Reference to the /user/ database path.
    this.usersRef = this.database.ref('users');
    // Make sure we remove all previous listeners.
    this.usersRef.off();

    // Loads the last 12 messages and listen for new ones.
    // var setMessage = function(data) {
    //     var val = data.val();
    //     this.displayMessage(data.key, val.name, val.text, val.photoUrl, val.imageUrl);
    // }.bind(this);
    this.usersRef.once('value').then(function(user) {
      var users = user.val();
      var userKeys = Object.keys(users);
      userKeys.forEach(function(userKey) {
        if (users[userKey].email === _this.auth.currentUser.email) {
          if (users[userKey].role === "patient") {
              _this.isDoctor = false;
              document.getElementById("messages-card-for-doctors").style.display = "none";
              document.getElementById("messages-card").style.display = "block";
          } else {
              _this.isDoctor = true;
              document.getElementById("messages-card-for-doctors").style.display = "block";
              document.getElementById("messages-card").style.display = "none";
          }
        }
      });
    });
};

// Loads chat messages history and listens for upcoming ones.
HealthJournal.prototype.loadMessages = function() {
  // Reference to the /messages/ database path.
  this.messagesRef = this.database.ref('messages');
  // Make sure we remove all previous listeners.
  this.messagesRef.off();

  // Loads the last 12 messages and listen for new ones.
  var setMessage = function(data) {
    var val = data.val();
    this.displayMessage(data.key, val.name, val.text, val.photoUrl, val.imageUrl, val.category, val.createdAt, val.comments);
  }.bind(this);
  this.messagesRef.limitToLast(12).on('child_added', setMessage);
  this.messagesRef.limitToLast(12).on('child_changed', setMessage);
};

// Saves a new message on the Firebase DB.
HealthJournal.prototype.saveMessage = function(e) {
  e.preventDefault();
  // Check that the user entered a message and is signed in.
  if (this.messageInput.value && this.checkSignedInWithMessage()) {
    var currentUser = this.auth.currentUser;
    // Add a new message entry to the Firebase Database.
      var message = {
          name: currentUser.displayName,
          text: this.messageInput.value,
          photoUrl: currentUser.photoURL || '/images/profile_placeholder.png',
          category: this.categoryInput.value,
          createdAt: firebase.database.ServerValue.TIMESTAMP
      };
    this.messagesRef.push(message).then(function() {
      // Clear message text field and SEND button state.
      HealthJournal.resetMaterialTextfield(this.messageInput);
      this.toggleButton();
    }.bind(this)).catch(function(error) {
      console.error('Error writing new message to Firebase Database', error);
    });
  }
};

// Sets the URL of the given img element with the URL of the image stored in Cloud Storage.
HealthJournal.prototype.setImageUrl = function(imageUri, imgElement) {
  // If the image is a Cloud Storage URI we fetch the URL.
  if (imageUri.startsWith('gs://')) {
    imgElement.src = HealthJournal.LOADING_IMAGE_URL; // Display a loading image first.
    this.storage.refFromURL(imageUri).getMetadata().then(function(metadata) {
      imgElement.src = metadata.downloadURLs[0];
    });
  } else {
    imgElement.src = imageUri;
  }
};

// Saves a new message containing an image URI in Firebase.
// This first saves the image in Firebase storage.
HealthJournal.prototype.saveImageMessage = function(event) {
  event.preventDefault();
  var file = event.target.files[0];

  // Clear the selection in the file picker input.
  this.imageForm.reset();

  // Check if the file is an image.
  if (!file.type.match('image.*')) {
    var data = {
      message: 'You can only share images',
      timeout: 2000
    };
    this.signInSnackbar.MaterialSnackbar.showSnackbar(data);
    return;
  }

  // Check if the user is signed-in
  if (this.checkSignedInWithMessage()) {

    // We add a message with a loading icon that will get updated with the shared image.
    var currentUser = this.auth.currentUser;
    this.messagesRef.push({
      name: currentUser.displayName,
      imageUrl: HealthJournal.LOADING_IMAGE_URL,
      photoUrl: currentUser.photoURL || '/images/profile_placeholder.png'
    }).then(function(data) {

      // Upload the image to Cloud Storage.
      var filePath = currentUser.uid + '/' + data.key + '/' + file.name;
      return this.storage.ref(filePath).put(file).then(function(snapshot) {

        // Get the file's Storage URI and update the chat message placeholder.
        var fullPath = snapshot.metadata.fullPath;
        return data.update({imageUrl: this.storage.ref(fullPath).toString()});
      }.bind(this));
    }.bind(this)).catch(function(error) {
      console.error('There was an error uploading a file to Cloud Storage:', error);
    });
  }
};

// Filter patient messages.
HealthJournal.prototype.filterMessage = function(e) {
  e.preventDefault();
      var filterValue = this.filterInput.value;

      // Filter messages by patient list
      var children = this.messageList.childNodes;
      children.forEach(function(item) {
        if (typeof item.getElementsByClassName == "function" && item.getElementsByClassName("name")[0]) {
            // Check that the user entered a message and is signed in.
            if (filterValue) {
              if (item.getElementsByClassName("name")[0].innerHTML.toLowerCase() == filterValue.toLowerCase()) {
                    item.style.display = null;
              } else {
                    item.style.display = "none";
              }
            } else {
                item.style.display = null;
            }
        }
      });
};

// Signs-in Friendly Chat.
HealthJournal.prototype.signIn = function() {
  // Sign in Firebase using popup auth and Google as the identity provider.
  var provider = new firebase.auth.GoogleAuthProvider();
  this.auth.signInWithPopup(provider);
};

// Signs-out of Friendly Chat.
HealthJournal.prototype.signOut = function() {
  // Sign out of Firebase.
  this.auth.signOut();
};

// Triggers when the auth state change for instance when the user signs-in or signs-out.
HealthJournal.prototype.onAuthStateChanged = function(user) {
  if (user) { // User is signed in!

    // Get profile pic and user's name from the Firebase user object.
    var profilePicUrl = user.photoURL;
    var userName = user.displayName;

    // Set the user's profile pic and name.
    this.userPic.style.backgroundImage = 'url(' + (profilePicUrl || '/images/profile_placeholder.png') + ')';
    this.userName.textContent = userName;

    // Show user's profile and sign-out button.
    this.userName.removeAttribute('hidden');
    this.userPic.removeAttribute('hidden');
    this.signOutButton.removeAttribute('hidden');

    // Hide sign-in button.
    this.signInButton.setAttribute('hidden', 'true');

    this.checkPermissions();

    // We load currently existing chant messages.
    this.loadMessages();

    // We save the Firebase Messaging Device token and enable notifications.
    this.saveMessagingDeviceToken();
  } else { // User is signed out!
    // Hide user's profile and sign-out button.
    this.userName.setAttribute('hidden', 'true');
    this.userPic.setAttribute('hidden', 'true');
    this.signOutButton.setAttribute('hidden', 'true');

    // Show sign-in button.
    this.signInButton.removeAttribute('hidden');
  }
};

// Returns true if user is signed-in. Otherwise false and displays a message.
HealthJournal.prototype.checkSignedInWithMessage = function() {
  // Return true if the user is signed in Firebase
  if (this.auth.currentUser) {
    return true;
  }

  // Display a message to the user using a Toast.
  var data = {
    message: 'You must sign-in first',
    timeout: 2000
  };
  this.signInSnackbar.MaterialSnackbar.showSnackbar(data);
  return false;
};

// Saves the messaging device token to the datastore.
HealthJournal.prototype.saveMessagingDeviceToken = function() {
  firebase.messaging().getToken().then(function(currentToken) {
    if (currentToken) {
      console.log('Got FCM device token:', currentToken);
      // Saving the Device Token to the datastore.
      firebase.database().ref('/fcmTokens').child(currentToken)
          .set(firebase.auth().currentUser.uid);
    } else {
      // Need to request permissions to show notifications.
      this.requestNotificationsPermissions();
    }
  }.bind(this)).catch(function(error){
    console.error('Unable to get messaging token.', error);
  });
};

// Requests permissions to show notifications.
HealthJournal.prototype.requestNotificationsPermissions = function() {
  console.log('Requesting notifications permission...');
  firebase.messaging().requestPermission().then(function() {
    // Notification permission granted.
    this.saveMessagingDeviceToken();
  }.bind(this)).catch(function(error) {
    console.error('Unable to get permission to notify.', error);
  });
};

// Resets the given MaterialTextField.
HealthJournal.resetMaterialTextfield = function(element) {
  element.value = '';
  element.parentNode.MaterialTextfield.boundUpdateClassesHandler();
};

// Template for messages.
HealthJournal.MESSAGE_TEMPLATE =
    '<div class="message-container">' +
      '<div class="spacing"><div class="pic"></div></div>' +
      '<div class="message"></div>' +
      '<div class="name"></div>' +
      '<div class="category"></div>' +
      '<div class="created_at"></div>' +
      '<div class="comments"></div>' +
    '</div>';

// A loading image URL.
HealthJournal.LOADING_IMAGE_URL = 'https://www.google.com/images/spin-32.gif';

// Displays a Message in the UI.
HealthJournal.prototype.displayMessage = function(key, name, text, picUrl, imageUri, category, created_at, comments) {
  var div = document.getElementById(key);
  // If an element for that message does not exists yet we create it.
  if (!div) {
    var container = document.createElement('div');
    container.innerHTML = HealthJournal.MESSAGE_TEMPLATE;
    div = container.firstChild;
    div.setAttribute('id', key);

    if (this.isDoctor) {
      this.appendCommentForm(div, key);
      this.messageListForDoctors.appendChild(div);
    } else {
        this.messageList.appendChild(div);
    }
  }
  if (picUrl) {
    div.querySelector('.pic').style.backgroundImage = 'url(' + picUrl + ')';
  }
  div.querySelector('.name').textContent = name;
  div.querySelector('.category').textContent = category;
  if (created_at) {
      div.querySelector('.created_at').textContent = new Date(created_at);
  }
  var messageElement = div.querySelector('.message');
  if (text) { // If the message is text.
    messageElement.textContent = text;
    // Replace all line breaks by <br>.
    messageElement.innerHTML = messageElement.innerHTML.replace(/\n/g, '<br>');
  } else if (imageUri) { // If the message is an image.
    var image = document.createElement('img');
    image.addEventListener('load', function() {
      this.messageList.scrollTop = this.messageList.scrollHeight;
    }.bind(this));
    this.setImageUrl(imageUri, image);
    messageElement.innerHTML = '';
    messageElement.appendChild(image);
  }

  if (comments && comments.length > 0) {
      var commentsDiv = div.querySelector('.comments');
      commentsDiv.innerHTML = "Comments";
      var ul = document.createElement("ul");
      comments.forEach(function(comment) {
        var li = document.createElement("li");
        li.innerHTML = comment;
        ul.appendChild(li);
      });
      commentsDiv.appendChild(ul);
      messageElement.appendChild(commentsDiv);
  }

  // Show the card fading-in and scroll to view the new message.
  setTimeout(function() {div.classList.add('visible')}, 1);
  this.messageList.scrollTop = this.messageList.scrollHeight;
  this.messageInput.focus();
};

HealthJournal.prototype.appendCommentForm = function (div) {
  var id = div.id;
  var a = document.createElement('a');
  var _this = this;
  a.addEventListener("click", function() {
    _this.addComment(id);
  });
  a.setAttribute("class", "add_comment");
  a.innerHTML = "Add Comment";
  div.appendChild(a);
  var commentForm = document.createElement('form');
  commentForm.id = id + "_comment_form";
  commentForm.setAttribute("class", "add-comment-form");
  commentForm.setAttribute("action", "#");
  var inputField = document.createElement("input");
  inputField.id = id + "_comment";
  inputField.setAttribute("class", "mdl_textfield__input");
  inputField.setAttribute("type", "text");
  commentForm.appendChild(inputField);
  var submitButton = document.createElement("button");
  submitButton.id = id + "_comment_submit";
  submitButton.setAttribute("class", "mdl-button mdl-js-button mdl-button--raised mdl-js-ripple-effect");
  submitButton.innerHTML = "Add";
  submitButton.addEventListener("click", function () {
     _this.submitComment(id);
  });
  commentForm.appendChild(submitButton);
  var clearButton = document.createElement("button");
  clearButton.setAttribute("class", "mdl-button mdl-js-button mdl-button--raised mdl-js-ripple-effect");
  clearButton.innerHTML = "Close";
  clearButton.addEventListener("click", function() {
    _this.clearComment(id);
  });
  commentForm.appendChild(clearButton);
  div.appendChild(commentForm);
};

// Enables or disables the submit button depending on the values of the input
// fields.
HealthJournal.prototype.toggleButton = function() {
  if (this.messageInput.value) {
    this.submitButton.removeAttribute('disabled');
  } else {
    this.submitButton.setAttribute('disabled', 'true');
  }
};

// Checks that the Firebase SDK has been correctly setup and configured.
HealthJournal.prototype.checkSetup = function() {
  if (!window.firebase || !(firebase.app instanceof Function) || !firebase.app().options) {
    window.alert('You have not configured and imported the Firebase SDK. ' +
        'Make sure you go through the codelab setup instructions and make ' +
        'sure you are running the codelab using `firebase serve`');
  }
};

HealthJournal.prototype.addComment = function(key) {
  var divComment = document.getElementById(key + "_comment_form");
  var commentField = document.getElementById(key + "_comment");
  commentField.text = "";
  divComment.style.display = "block";
};

HealthJournal.prototype.clearComment = function(key) {
    var divComment = document.getElementById(key + "_comment_form");
    var commentField = document.getElementById(key + "_comment");
    commentField.text = "";
    divComment.style.display = "none";
};

HealthJournal.prototype.submitComment = function(key) {
    var divComment = document.getElementById(key + "_comment_form");
    var comment = document.getElementById(key + "_comment").value;
    var _this = this;

    if (comment) {
        this.database.ref("/messages/" + key).once('value').then(function(snap) {
            var message = snap.val();
            if (!message.comments) {
                message.comments = [];
            }
            message.comments.push(comment);
            _this.database.ref("/messages/" + key).update(message).then(function() {
                divComment.style.display = "none";
            });
        });
    }
};


window.onload = function() {
  window.healthJournal = new HealthJournal();
};

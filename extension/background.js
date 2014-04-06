// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var urlMap = [];
var SERVER_URL = "https://terra-incognita.co/";
var COOKIE_PATH ="https://terra-incognita.co/login/";

//var SERVER_URL = "http://localhost:5000/";
//var COOKIE_PATH ="http://localhost:5000/login/";

var LOGIN_PAGE = "login/";
var LOGIN_URL = SERVER_URL + LOGIN_PAGE;
var DAYS_HISTORY = 30;
var USER_COOKIE = "terra-incognita-id";
var USER_ID = null;
var IS_LOGGED_IN = false;
var USER_JSON = null;

function checkLoggedIn(callback){
	chrome.cookies.get({ url: COOKIE_PATH, name: USER_COOKIE },
			function (cookie) {
				if (cookie) {
						console.log("user logged in");
						IS_LOGGED_IN = true;
						USER_ID = cookie.value;
						
				}else{
					console.log("user not logged in");
					IS_LOGGED_IN = false;
					USER_ID = null;
					
				}
				callback();
		});
	
}
function initBackground(){
	checkLoggedIn(function(){console.log("initBackground::checkLoggedIn: " + IS_LOGGED_IN)});
}
initBackground();

/*
	Listens for pages sending stuff
*/
chrome.runtime.onMessage.addListener(
	function(request, sender, sendResponse)
	{
		if (request.msg == "checkLoggedIn")
		{
				checkLoggedIn( function(){
					sendResponse({isLoggedIn: IS_LOGGED_IN, loginURL : SERVER_URL + LOGIN_PAGE, userID : USER_ID});
				});
				return true;
		}
		
		else if (request.msg == "loadReadingLists")
		{
				var xhr = new XMLHttpRequest();
				
				xhr.open("GET",SERVER_URL + 'readinglist/' + USER_ID + '/' + request.city_id, true);
				
				xhr.onreadystatechange = function() {
					if (xhr.readyState == 4) {
						
						readingListJSON = JSON.parse(xhr.responseText);
						console.log(readingListJSON);
						sendResponse({readingLists: readingListJSON});
					}
				}
				xhr.send();
				return true;
		}
		else if (request.msg == "loadCityStats")
		{
				var xhr = new XMLHttpRequest();
				
				xhr.open("GET",SERVER_URL + 'citystats/' + USER_ID + '/' + request.city_id, true);
				
				xhr.onreadystatechange = function() {
					if (xhr.readyState == 4) {
						
						cityStatsJSON = JSON.parse(xhr.responseText);
						console.log(cityStatsJSON);
						sendResponse({cityStats: cityStatsJSON});
					}
				}
				xhr.send();
				return true;
		}
		else if (request.msg == "submitRecommendation")
		{
				var xhr = new XMLHttpRequest();
				
				xhr.open("GET",SERVER_URL + 'recommend/' + USER_ID + '/' + request.city_id +'?url=' + request.url, true);
				
				xhr.onreadystatechange = function() {
					if (xhr.readyState == 4) {
						
						resultJSON = JSON.parse(xhr.responseText);
						console.log(resultJSON);
						sendResponse({result: resultJSON});
					}
				}
				xhr.send();
				return true;
		}
		else if (request.msg == "submitHistoryItemRecommendation")
		{
				var xhr = new XMLHttpRequest();
				
				xhr.open("GET", SERVER_URL + 'like/' + USER_ID + '/' + request.city_id + '?isThumbsUp=' + request.isThumbsUp + '&url=' + request.url, true);
				
				xhr.onreadystatechange = function() {
					if (xhr.readyState == 4) {
						
						resultJSON = JSON.parse(xhr.responseText);
						console.log(resultJSON);
						sendResponse({result: resultJSON});
					}
				}
				xhr.send();
				return true;
		}
	}
);
/*
	Stuff to do right when app is installed:
	- Get 30 days of browser history, filter to see which URLs to keep & send to server
	- store in localStorage until they have a userID
*/
chrome.runtime.onInstalled.addListener(function(details) {
	console.log("onInstalled");

	chrome.storage.local.get("terraIncognitaUserHistory", 
			function(result){
				if ("terraIncognitaUserHistory" in result){
					var val = result["terraIncognitaUserHistory"]
					console.log("User pre-installation history has already been saved.")
				} else{
					console.log("Saving user pre-installation history.")
					var today = new Date();
					var startCollecting = today.getTime() - DAYS_HISTORY*24*60*60*1000;
					filteredResults = [];
					chrome.history.search({text: '', startTime:startCollecting, maxResults:1000000000}, function(results) 
						{ 
							
							console.log("logging " + DAYS_HISTORY + " days browsing history"); 
							
							for (var i = 0;i<results.length;i++){
								var result = results[i];
								if (keepURL(result.url)){
									filteredResults.push(result);
								}
							}
							console.log(filteredResults.length + " results after filtering");
							chrome.storage.local.set({"terraIncognitaUserHistory":filteredResults});
						});
					/*
						User's city visits are saved in local storage until the user has an ID
						Then they are sent to server for preinstallation comparison
					*/
					
				}
			});

	
	
});


/*
	Launch app on new tab
*/
chrome.tabs.onCreated.addListener(function(tab) {
	console.log('New tab created');

	if (USER_ID != null){

		/*
			Check if we should send their prior browsing history or if we've already done that
		*/
		chrome.storage.local.get("terraIncognitaUserHistory", 
												function(result){
													if ("terraIncognitaUserHistory" in result){
														var val = result["terraIncognitaUserHistory"]
														if (val != "done"){
															postData('history/' + USER_ID + '/', 'history', val, function(){
																chrome.storage.local.set({"terraIncognitaUserHistory":"done"});
															});
															
														}
													} 
												});
		
		/*
			Then get user information like cities visited, etc
		*/
		var xhr = new XMLHttpRequest();
		xhr.open("GET",SERVER_URL + 'user/' + USER_ID, true);
		xhr.onreadystatechange = function() {
			if (xhr.readyState == 4) {
				
				USER_JSON = JSON.parse(xhr.responseText);
				console.log(USER_JSON);

				chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
				  chrome.tabs.sendMessage(tabs[0].id, {user: USER_JSON}, function(response) {
				    console.log(response);
				  });
				});
			}
		}
		xhr.send();
	}
	
});

/*
	Tab changes or new tab 
*/
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
				
		if (changeInfo.status == "loading" && changeInfo.url != "undefined"){
						urlMap[tabId] = true;
		}
		else if (urlMap[tabId] && changeInfo.status == "complete"){
			urlMap[tabId] = false;
			
			checkLoggedIn(function(){
				//retrieve latest URL from history so we get the metadata
				chrome.history.search({text: '', maxResults:1}, function(results)
				{
					if (tab.url == results[0].url && keepURL(results[0].url)){
						historyObject = results[0];
						historyObject.userID = USER_ID;
						postData('monitor/', 'logURL', historyObject, null);
					}
				});
			});
		}
});
/* 
	Terra Incognita only looks at news sites as defined by MediaCloud - www.mediacloud.org.
	It doesn't analyze your email, facebook, twitter. 
*/
function keepURL(url){
	//first check url against blacklist
	for (var i=0;i<BLACKLIST.length;i++){
		if (url.indexOf(BLACKLIST[i]) > -1){
			return false;
		}
	}
	//then check url against whitelist
	for (i=0;i<WHITELIST.length;i++){
		if (url.indexOf(WHITELIST[i]) > -1){
			return true;
		}
	}
	return false;
}

/*
	Handles post requests to server
*/
function postData(routeName, paramName, data, successCallback){
	console.log("Route: " + routeName);
	var json = JSON.stringify(data);
	var http = new XMLHttpRequest();
	var params = paramName+"="+encodeURIComponent(json);

	http.open("POST", SERVER_URL + routeName, false);
	http.setRequestHeader("Content-type", "application/x-www-form-urlencoded");

	http.onreadystatechange = function() {
			if(http.readyState == 4 && http.status == 200) {
					console.log(http.responseText);
					successCallback();
			}
	};
	http.send(params);
}




from boilerpipe.extract import Extractor
from bson.objectid import ObjectId
from bson import BSON
from bson import json_util
from flask import Flask, session, render_template, json, jsonify, request
from flask.ext.browserid import BrowserID
from flask.ext.login import LoginManager
from pymongo import MongoClient
from user import get_user_from_DB_row, create_new_user
import ConfigParser
import datetime
import httplib
import json
import logging
import os
import pprint
import pymongo
import requests
import requests.exceptions
from mapreduce import *

# constants
CONFIG_FILENAME = 'app.config'
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# read in app config
config = ConfigParser.ConfigParser()
config.read(os.path.join(BASE_DIR,CONFIG_FILENAME))

app = Flask(__name__,static_url_path='')
app.secret_key= config.get('app','secret_key')

# Geoserver
app.geoserver = config.get('geoparser','geoserver_url')

# MongoDB & links to each collection
db_client = MongoClient()
app.db = db_client[config.get('db','name')]
app.db_user_history_collection = app.db[config.get('db','user_history_item_collection')]
app.db_user_collection = app.db[config.get('db','user_collection')]
app.db_recommendation_collection = app.db[config.get('db','recommendation_item_collection')]

# ------------------------- -------------------------------------
# MOVE THIS SOMEWHERE ELSE
# This callback is used to reload the user object from the user ID stored in the session.
# It should take the unicode ID of a user, and return the corresponding user object.
# It should return None (not raise an exception) if the ID is not valid.
# (In that case, the ID will manually be removed from the session and processing will continue.)
def get_user_by_id(id):
	user = None
	for row in app.db_user_collection.find({ '_id': ObjectId(id) }):
		user = get_user_from_DB_row(row)
		user.lastLoginDate = datetime.datetime.utcnow();
		break
	if (user is not None):
		app.db_user_collection.save(user.__dict__)
	return user


#	Given the response from BrowserID, finds or creates a user.
#	If a user can neither be found nor created, returns None.
#	NOTE THAT ID must be converted to STRING from MongoDB
def get_user_for_browserid(kwargs):
	
	for row in app.db_user_collection.find({ 'email': kwargs.get('email') }):
		if row is not None:
			return get_user_from_DB_row(row)
	for row in app.db_user_collection.find({ '_id': kwargs.get('id') }):
		if row is not None:
			return get_user_from_DB_row(row)
	# not found - create the user
	return create_browserid_user(kwargs)


#	Takes browserid response and creates a user.
def create_browserid_user(kwargs):
	
	if kwargs['status'] == 'okay':
		user = create_new_user(kwargs["email"])
		user_id = app.db_user_collection.insert(user.__dict__)
		user._id = user_id
		return user
	else:
		return None

# END MOVE THIS SOMEWHERE ELSE
# ------------------------- -------------------------------------

#Mozilla Persona
login_manager = LoginManager()
login_manager.user_loader(get_user_by_id)
login_manager.init_app(app)

browser_id = BrowserID()
browser_id.user_loader(get_user_for_browserid)
browser_id.init_app(app)

# setup logging and pretty log.info(ng)
handler = logging.FileHandler(BASE_DIR + "/" + 'server.log')
logging.basicConfig(filename='server.log',level=logging.DEBUG)
log = logging.getLogger('server')
log.info("---------------------------------------------------------------------------")



#Index test 
@app.route('/')
@app.route('/index.html')
@app.route('/index.htm')
def hello():
	return app.send_static_file('googleForm.html')

#Individual Map test 
@app.route('/individual_map.html')
def individual_map():
	return app.send_static_file('individual_map.html')

#DR Map test 
@app.route('/dr_map.html')
def dr():
	return app.send_static_file('dr_map.html')

#RB Map test 
@app.route('/rb_map.html')
def rb():
	return app.send_static_file('rb_map.html')

#EDP Map test 
@app.route('/edp_map.html')
def edp():
	return app.send_static_file('edp_map.html')

#EG Map test 
@app.route('/eg_map.html')
def eg():
	return app.send_static_file('eg_map.html')


#EG Whitelist Map test 
@app.route('/eg_whitelist_map.html')
def eg_whitelist():
	return app.send_static_file('eg_whitelist_map.html')

#CSD Map test
@app.route('/csd_map.html')
def csd():
	return app.send_static_file('csd_map.html')

#Send user their map data
@app.route('/map/<user>')
def map(user=None):
	if (user is not None):
		userHistory = {"countries":[], "states":[], "cities":[]}
		
		#countries
		q = app.db.command('aggregate', config.get('db','user_history_item_collection'), pipeline=COUNTRY_COUNT_PIPELINE )
		userHistory["countries"].append(q['result'])

		#states
		q = app.db.command('aggregate', config.get('db','user_history_item_collection'), pipeline=STATE_COUNT_PIPELINE )
		userHistory["states"].append(q['result'])

		#cities
		q = app.db.command('aggregate', config.get('db','user_history_item_collection'), pipeline=CITY_COUNT_PIPELINE )
		userHistory["cities"].append(q['result'])
		
		return json.dumps(userHistory, sort_keys=True, indent=4, default=json_util.default) 
	else:
		return jsonify(error='No user ID specified');

@app.route('/history/', methods=['POST'])
def processHistory():
	log.info("Processing browser history")
	historyItems = json.loads(request.form['history'])
	#docIDs = db_collection.insert(historyItems)
	
	#batchExtractor = BatchExtractor(docIDs, db_collection)
	#batchExtractor.run()
	return 'Got your message dude - inserted and extracted' + str(len(docIDs)) + ' history items'

#Login/Logout page
@app.route('/login/')
def loginpage():
	return render_template('login.html')


# Receives a single URL object from user, extracts, geoparses and stores in DB
@app.route('/monitor/', methods=['POST','GET'])
def processURL():
	log.info("Receiving new URL")
	historyObject = json.loads(request.form['logURL'])
	historyObject["extractedText"] = extractSingleURL(historyObject["url"])
	historyObject["geodata"] = geoparseSingleText(historyObject["extractedText"])
	docID = app.db_user_history_collection.insert(historyObject)
	
	return 'Processed your URL dude - ' + historyObject["url"]

def geoparseSingleText(text):
	try:
		params = {'text':text}
		
		r = requests.get(app.geoserver, params=params)
		log.info(r.url)
		log.info(json.dumps(r.json(),sort_keys=True,indent=4, separators=(',', ': ')))
		
		geodata = r.json()
		if len(geodata["places"]) > 0:
			return geodata
			
	except requests.exceptions.RequestException as e:
		log.info("ERROR RequestException " + str(e))

def extractSingleURL(url):
	try:
		extractor = Extractor(extractor='ArticleExtractor', url=url)
		extractedText = extractor.getText()
		log.info((extractor.getHTML()))
		if (len(extractedText) > 0):
			# make sure to include title in the extracted text object so it
			# gets geoparsed
			title = extractor.getTitle()
			
			if title is not None:
				extractedText = title + " " + extractedText
			log.info('EXTRACTED -' + url)
			return extractedText
	except IOError, err:
		log.info("IOError with url " + url)
		log.info(str(err))
	except (LookupError):
		log.info("LookupError - Maybe not text or weird encoding " + url)
	except (UnicodeDecodeError, UnicodeEncodeError):
		log.info("UnicodeDecodeError or UnicodeEncodeError- " + url)
	except Exception, err:
		log.info("Unknown Exception: " + url)
		log.info(str(err))

if __name__ == '__main__':
	#reconfigure log to send to separate file
	app.run(debug=True)
	log.info("Started Server")

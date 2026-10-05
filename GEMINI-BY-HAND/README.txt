========================================
 GEMINI BY HAND - POORA TAREEQA
========================================

Is folder mein woh sab kuch hai jo Gemini se story banwane ke liye
chahiye. Tool (us ka API, browser automation, Flow waghera) yahan
nahi hai - woh upar wale folder mein hai.

Ye tareeqa API key ke bagair chalta hai: Gemini ka jawab aap khud
copy-paste karte hain. Baqi sab kaam tool khud karta hai, aur natija
bilkul wohi hota hai jo API se banta.


----------------------------------------
 STEPS (bas 3)
----------------------------------------

STEP 1 - Gemini se prompt lena
   File kholein:  master_prompt_relationship-dialogue-real.md
   "YAHAN SE NEECHE COPY KAREIN" line ke baad ka poora text copy karein
   (upar ka Urdu hissa copy NA karein).

STEP 2 - Gemini ko dena
   https://aistudio.google.com/prompts/new_chat kholein
   Text paste karein, aur sab se aakhir mein:
       <PASTE THE VIDEO LINK HERE>
   ki jagah apna YouTube video ka link laga dein.

   Gemini ek hi jawab mein DOJSON dega:
     - pehla : title, cast, place, outline (8 beats)
     - doosra: scenes (8 clips, dialogue ke sath)

STEP 3 - Story banana
   Gemini ka poora jawab copy kar ke ek .txt file mein save karein
   (Notepad mein paste kar ke Save As > naya naam.txt).

   Phir:  1 - STORY BANAO.bat  pe DOUBLE-CLICK karein
          (ya us .txt file ko is .bat ke upar DRAG kar dein)

   Title khali chhor dein - story ka naam video ke apne title se
   ban jayega.

Bas. Story ban gayi.


----------------------------------------
 IS KE BAAD
----------------------------------------

Story yahan banti hai:
    ..\stories\<video-ka-title>\

Us folder mein 4 cheezein hongi:
    <naam>_story.json        poori story
    style_bible.md           look, palette, camera
    character_sheets.txt     3 tasveerein banane ke prompts
    character_refs\          (khali) yahan tasveerein rakhni hain

character_sheets.txt kholein - us mein 3 image prompts hain
(2 characters + 1 place). Har prompt kisi bhi image tool mein daalein
aur jo tasveer banay usay character_refs folder mein in naamon se
rakh dein:

    david.jpg        (ya jo bhi character ka naam ho)
    elena.jpg
    Kitchen.jpg      (place ka naam - character_sheets.txt mein likha hai)

Phir:  2 - AGENT PROMPT BANAO.bat  pe double-click karein,
       folder ka naam likh dein. agent_prompt.txt ban jayega.

Uske baad ka kaam tool ke apne README mein hai (Flow mein clips
banwana waghera).


----------------------------------------
 IS FOLDER KI FILES
----------------------------------------

1 - STORY BANAO.bat
      Gemini ka jawab (.txt) -> poori story. Yahi sab se ahem file hai.

2 - AGENT PROMPT BANAO.bat
      Story -> agent_prompt.txt (stage 1).

master_prompt_relationship-dialogue-real.md
      Wohi prompt jo tool Gemini ko bhejta hai, is preset ke liye.
      Yahi Gemini ko dena hai. "relationship-dialogue-real" preset ke
      liye hai.

preset_prompt_relationship_real.txt
      Upar wali .md file isi se banti hai (tool ke --dry-run ka output).

build_master_prompt.js
      Upar wali .md file banata hai:
          node build_master_prompt.js

make_story_from_answer.js
      .bat file asal mein isi ko chalati hai. Ye Gemini ke jawab mein se
      dono JSON dhoondta hai, alag karta hai, aur tool ko de deta hai.
      Ye khud bhi chala sakte hain:
          node make_story_from_answer.js jawab.txt --preset relationship-dialogue-real

test_make_story_from_answer.js
      Upar wale script ka test:
          node test_make_story_from_answer.js

_answers\
      Har jawab yahan mehfooz reh jata hai (folder ke naam se), taake
      zaroorat pare to story dobara banayi ja sake - Gemini se dobara
      poochne ki zaroorat nahi:
          node make_story_from_answer.js _answers\1st\jawab.txt --preset ...


----------------------------------------
 AGAR KUCH MASLA HO
----------------------------------------

"has no JSON object in it"
    Jawab wali file mein Gemini ka jawab nahi mila. Poora jawab save
    karein, jaise aaya tha.

"has no title in it, so --title is required"
    Purane prompt ka jawab hai, us mein title nahi hota. Ye bat chala
    kar title likh dein.

REFUSING TO WRITE ... failed validation
    Gemini ne kahani mein kuch aisa likha jo tool ke rules ke khilaf hai
    (maslan kisi clip mein aisa character bol raha hai jo cast mein nahi).
    Tool jhooti story nahi banata. Gemini se dobara likhwayein.

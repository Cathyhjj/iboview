#include <cassert>
#include <cstdint>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include <QApplication>
#include <QClipboard>
#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJSEngine>
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QSaveFile>
#include <QTemporaryDir>
#include <QVariant>

#include "CxVec3.h"
#include "format.h"
using FVec3d = ct::TVector3<double>;

// The application boundaries record notifications and line properties. Parsing,
// argument handling, quoting, and file I/O below are the production function bodies.
static QStringList Messages, Errors;
enum { NOTIFY_Error };
template<class... Args> static void IvEmit(QString const &message, Args const &...)
{
   Messages.append(message);
}
static void IvNotify(int, QString const &message) { Errors.append(message); }
static QString IvFmt(QString const &format, QString const &a, QString const &b)
{
   return format.arg(a, b);
}

class FFreeLine : public QObject {
public:
   FVec3d from{0., 0., 0.}, to{0., 0., 0.};
   QVariantMap options;
   explicit FFreeLine(QObject *parent) : QObject(parent) {}
   void SetFrom(FVec3d const &value) { from = value; }
   void SetTo(FVec3d const &value) { to = value; }
   void setp(QVariantMap const &value) { options = value; }
};

struct FVolumeVisualConfigDetails { virtual ~FVolumeVisualConfigDetails() = default; };
struct FTwoPhaseIsoSurfaceConfig : FVolumeVisualConfigDetails { uint32_t cIsoPlus, cIsoMinus; };
struct FVolumeVisualConfig { std::shared_ptr<FVolumeVisualConfigDetails> pDetails; };
struct FDataSet { virtual ~FDataSet() = default; bool Active = false; };
struct FOrbital : FDataSet { std::shared_ptr<FVolumeVisualConfig> pVisConfig; };
using FDataSetPtr = std::shared_ptr<FDataSet>;
using FDataSetList = std::vector<FDataSetPtr>;
struct TestFrame {
   QString path;
   QString GetFullInputFileName() const { return path; }
};
struct TestDocument {
   std::vector<TestFrame> frames;
   FDataSetList datasets;
   QString GetCurrentInputFileName() const { return frames.front().path; }
   int GetNumFrames() const { return int(frames.size()); }
   TestFrame *GetFrame(int index) { return &frames.at(size_t(index)); }
   FDataSetList *GetCurrentFrameData() { return &datasets; }
   void WriteExtendedStateScript(std::ostream &) {}
};
struct TestView { QString GetViewDesc() const { return {}; } };
class FMainWindow {
public:
   TestDocument *document;
   TestView *view3d;
   QString MakeStateScript();
   void WriteStateScript(QString FileName);
};
static std::string q2s(QString const &value) { return value.toStdString(); }
static QString s2q(std::string const &value) { return QString::fromStdString(value); }

#include "qt_functions.inc"

static void CheckIsoParsing()
{
   struct Case { char const *text; double value; uint32_t color; };
   for (Case const &entry : {
      Case{"(0.05,7fff5e5b)", 0.05, 0x7fff5e5b},
      Case{"(0.005,50ffc65a)", 0.005, 0x50ffc65a},
      Case{"(-0.05,7f5b5eff)", -0.05, 0x7f5b5eff},
      Case{"(-0.005,505ac6ff)", -0.005, 0x505ac6ff},
   }) {
      auto implicit = FIsoSliceDecl::fromString(entry.text);
      bool ok = false;
      auto explicitResult = FIsoSliceDecl::fromString(entry.text, &ok);
      assert(ok);
      assert(implicit.fIsoValue == entry.value && implicit.dwColor == entry.color);
      assert(explicitResult.fIsoValue == entry.value && explicitResult.dwColor == entry.color);
   }
   for (char const *text : {"invalid", "(,ffffffff)", "(0.05,)", "(0.05,100000000)"}) {
      bool ok = true;
      FIsoSliceDecl::fromString(text, &ok);
      assert(!ok);
   }
}

static void CheckScriptQuoting(QJSEngine &engine)
{
   QStringList paths = {
      "/tmp/plain.xyz", "/tmp/quoted\"sample.xyz", "C:\\Users\\me\\sample.xyz",
      "/tmp/line\nbreak\tand\rreturn.xyz", QString::fromUtf8("/tmp/分子.xyz"),
      "/tmp/\"); throw new Error('injected'); //.xyz",
      QString("/tmp/a") + QChar(0x2028) + QChar(0x2029) + "b.xyz",
   };
   QStringList literals;
   for (QString const &path : paths) {
      std::string encoded = ScriptStringLiteral(path);
      QString literal = QString::fromUtf8(encoded.data(), qsizetype(encoded.size()));
      assert(!literal.contains('\n') && !literal.contains(QChar(0x2028)) && !literal.contains(QChar(0x2029)));
      QJSValue result = engine.evaluate("(" + literal + ")");
      assert(!result.isError() && result.toString() == path);
      literals.append(literal);
   }
   QJSValue array = engine.evaluate("[" + literals.join(',') + "]");
   assert(!array.isError());
   for (int i = 0; i < paths.size(); ++i)
      assert(array.property(quint32(i)).toString() == paths[i]);

   TestDocument document;
   TestView view;
   FMainWindow window{&document, &view};
   auto checkState = [&]() {
      engine.evaluate("var loadedPaths = []; var app = { load_file: function(p) { loadedPaths = [p]; },"
                      "load_files: function(p) { loadedPaths = p; }}; var doc = { num_frames: function() { return 0; }};");
      QJSValue result = engine.evaluate(window.MakeStateScript());
      assert(!result.isError());
      QJSValue loaded = engine.globalObject().property("loadedPaths");
      assert(loaded.property("length").toInt() == document.GetNumFrames());
      for (int i = 0; i < document.GetNumFrames(); ++i)
         assert(loaded.property(quint32(i)).toString() == document.GetFrame(i)->path);
   };
   for (QString const &path : paths) {
      document.frames = {{path}};
      checkState();
   }
   document.frames.clear();
   for (QString const &path : paths)
      document.frames.push_back({path});
   checkState();
}

static void CheckFreeLine(QJSEngine &engine)
{
   FScriptGlobals globals{&engine};
   QVariantList from{1., 2., 3.};
   QVariantMap to{{"x", -4.}, {"y", 5.}, {"z", 6.}};
   QVariantList args{QVariant(from), QVariant(to)};
   QJSValue value = globals.freeline_impl(args);
   assert(!value.isError());
   auto *line = static_cast<FFreeLine *>(value.toQObject());
   assert(line && line->from == FVec3d(1., 2., 3.) && line->to == FVec3d(-4., 5., 6.));
   assert(line->options.isEmpty());
   args.append(QVariantMap{{"width", 0.5}, {"color", 0xff123456u}});
   value = globals.freeline_impl(args);
   line = static_cast<FFreeLine *>(value.toQObject());
   assert(line && line->from == FVec3d(1., 2., 3.) && line->to == FVec3d(-4., 5., 6.));
   assert(line->options.value("width").toDouble() == 0.5);
   assert(line->options.value("color").toUInt() == 0xff123456u);
   assert(globals.freeline_impl({}).isError());
   assert(globals.freeline_impl({QVariant(from)}).isError());
}

static void CheckAtomicSave()
{
   QTemporaryDir directory;
   assert(directory.isValid());
   TestDocument document;
   document.frames = {{QString::fromUtf8("分子.xyz")}};
   TestView view;
   FMainWindow window{&document, &view};
   QByteArray expected = window.MakeStateScript().toUtf8();
   QString target = directory.filePath("state.js");
   QFile original(target);
   assert(original.open(QIODevice::WriteOnly));
   assert(original.write("previous state") == 14);
   original.close();
   Errors.clear(); Messages.clear();
   window.WriteStateScript(target);
   assert(Errors.isEmpty() && Messages.size() == 1);
   assert(original.open(QIODevice::ReadOnly));
   assert(original.readAll() == expected);
   original.close();
   assert(QDir(directory.path()).entryList(QDir::Files | QDir::Hidden).size() == 1);

   Errors.clear(); Messages.clear();
   QString missingParent = directory.filePath("missing/state.js");
   window.WriteStateScript(missingParent);
   assert(Errors.size() == 1 && Messages.isEmpty() && !QFile::exists(missingParent));

   Errors.clear(); Messages.clear();
   window.WriteStateScript(directory.path());
   assert(Errors.size() == 1 && Messages.isEmpty());
   assert(original.open(QIODevice::ReadOnly));
   assert(original.readAll() == expected);
}

int main(int argc, char **argv)
{
   QCoreApplication application(argc, argv);
   QJSEngine engine;
   CheckIsoParsing();
   CheckScriptQuoting(engine);
   CheckFreeLine(engine);
   CheckAtomicSave();
   std::cout << "PASS: Qt iso parsing, JavaScript quoting, FreeLine, and atomic state-save regressions\n";
}
